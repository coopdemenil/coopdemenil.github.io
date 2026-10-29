(() => {
const { configure, loadTransactions, membersFrom, summarizeContributions, extractId } = window.CoopData;
const Auth = window.CoopAuth;

const $ = (sel) => document.querySelector(sel);
const video = $('#video');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let members = [];
let transactions = [];
let transactionsOk = false;
let stream = null;
let scanning = false;

function setStatus(text) { $('#status').textContent = text; }

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.dataset.screen !== name);
  // Liens du bas : uniquement sur l'accueil du scanner (pas à la connexion ni sur une fiche).
  $('#home-links').hidden = name !== 'scan';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtEuro = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} €`;
const fmtDate = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function renderContributions(s) {
  const rows = s.recent.map(r => `
      <li class="${r.amount > 0 ? 'paid' : 'missing'}">
        <span>${escapeHtml(r.label)}</span><span>${r.amount > 0 ? fmtEuro(r.amount) : '—'}</span>
      </li>`).join('');
  return `
    <dl class="stats">
      <div><dt>Dernière contribution</dt><dd>${fmtEuro(s.last.amount)} <span class="muted">· ${fmtDate(s.last.date)}</span></dd></div>
      <div><dt>Total</dt><dd>${fmtEuro(s.totalAmount)} <span class="muted">· ${s.count} contribution${s.count > 1 ? 's' : ''}</span></dd></div>
    </dl>
    <p class="contrib ${s.upToDate ? 'ok' : 'ko'}">${s.upToDate ? 'À jour ce mois-ci' : 'Pas de contribution ce mois-ci'}</p>
    <ul class="months">${rows}</ul>`;
}

function renderMember(id) {
  stopScanner();
  const m = members.find(x => x.id === id);
  const card = $('#member');
  shareTarget = null;
  if (!m) {
    card.className = 'member unknown';
    card.innerHTML = `<h2>Carte inconnue</h2><p class="muted">Aucun contributeur avec le pseudo « ${escapeHtml(id)} ».</p>`;
  } else {
    const s = summarizeContributions(transactions, m.id);
    card.className = `member ${s.upToDate ? 'uptodate' : 'late'}`;
    card.innerHTML = `
      <button class="share-icon" type="button" aria-label="Partager la carte" title="Partager la carte"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/></svg></button>
      <p class="label">${escapeHtml(m.id)}</p>
      <h2>${escapeHtml(m.name)}</h2>
      <p class="since">Sociétaire depuis le ${fmtDate(s.first.date)}</p>
      <p class="badge">${escapeHtml(m.tier)}</p>
      ${renderContributions(s)}`;
    shareTarget = { name: m.name, url: memberCardUrl(m, s) };
  }
  showScreen('result');
}

// ---- Partage de la carte de membre (page autonome membre.html, sans mot de passe)
let shareTarget = null;

function memberCardUrl(m, s) {
  const q = new URLSearchParams({ id: m.id, n: m.name });
  if (s && s.first) {
    const d = s.first.date;
    q.set('d', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return `${location.origin}${location.pathname.replace(/(index\.html)?$/, '')}membre?${q}`;
}

async function shareCard() {
  if (!shareTarget) return;
  const { name, url } = shareTarget;
  const text = "Ta carte de membre de la Coopérative de Ménilmontant. Ouvre le lien, puis touche « Ajouter la carte à l'écran d'accueil » sous ta carte pour l'avoir toujours sur toi.";
  try {
    if (navigator.share) { await navigator.share({ title: `Carte de membre · ${name}`, text, url }); return; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  const btn = $('#member .share-icon');
  try { await navigator.clipboard.writeText(url); btn.classList.add('copied'); btn.title = 'Lien copié'; }
  catch { prompt('Copie ce lien :', url); return; }
  setTimeout(() => { btn.classList.remove('copied'); btn.title = 'Partager la carte'; }, 1600);
}

// Décode une image (frame vidéo ou photo) et renvoie l'id trouvé, sinon null.
function decode(source, width, height) {
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(source, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return code && code.data ? { id: extractId(code.data), raw: code.data } : null;
}

function explainCameraError(err) {
  const name = err && err.name;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'Ce navigateur ne donne pas accès à la caméra. Ouvre le lien dans Safari ou Chrome directement.';
  }
  if (!window.isSecureContext) return 'La caméra exige une adresse en https://.';
  if (name === 'NotAllowedError') return 'Accès caméra refusé. Sur iPhone : Réglages → Safari → Caméra → Autoriser, puis recharge la page.';
  if (name === 'NotFoundError') return 'Aucune caméra trouvée sur cet appareil.';
  if (name === 'NotReadableError') return 'Caméra occupée par une autre application.';
  return `${name || 'Erreur'} : ${err && err.message ? err.message : 'inconnue'}`;
}

// Doit être appelé depuis un geste utilisateur (tap) : Safari iOS le demande.
async function startScanner() {
  showScreen('scan');
  $('#start').hidden = true;
  setStatus('Ouverture de la caméra…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    stopScanner();
    setStatus('Caméra indisponible. ' + explainCameraError(err));
    $('#start').textContent = 'Réessayer la caméra';
    $('#start').hidden = false;
    return;
  }
  scanning = true;
  setStatus('Vise un QR code');
  requestAnimationFrame(tick);
}

function stopScanner() {
  scanning = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
}

function tick() {
  if (!scanning) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
    const found = decode(video, video.videoWidth, video.videoHeight);
    if (found) {
      if (found.id) {
        if (navigator.vibrate) navigator.vibrate(80);
        renderMember(found.id);
        return;
      }
      setStatus('QR code lu, mais pas de carte membre dedans');
    }
  }
  requestAnimationFrame(tick);
}

// Repli : photo prise avec l'appareil photo natif, décodée ensuite.
async function scanPhoto(file) {
  if (!file) return;
  stopScanner();
  setStatus('Lecture de la photo…');
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const found = decode(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    bitmap.close && bitmap.close();
    if (found && found.id) { renderMember(found.id); return; }
    setStatus(found ? 'QR code lu, mais pas de carte membre dedans' : 'Aucun QR code lisible sur la photo. Réessaie de plus près.');
  } catch (err) {
    setStatus('Photo illisible : ' + err.message);
  }
  $('#start').hidden = false;
}

function showIdle() {
  showScreen('scan');
  $('#start').textContent = 'Démarrer la caméra';
  $('#start').hidden = false;
  setStatus('Appuie sur le bouton pour scanner une carte.');
}

// Après déverrouillage : charge les transactions puis ouvre le scanner ou la fiche demandée.
async function start(config) {
  configure(config);
  showScreen('scan');
  $('#source').textContent = 'Chargement des contributions';
  const tx = await loadTransactions();
  transactions = tx.transactions;
  transactionsOk = tx.ok;
  members = membersFrom(transactions);
  const src = $('#source');
  if (!tx.ok) {
    src.textContent = 'Onglet Transactions injoignable : ' + tx.error;
    src.className = 'source demo';
  } else {
    src.textContent = `${members.length} sociétaires`;
    src.className = 'source sheet';
  }

  const id = extractId(new URLSearchParams(location.search).get('id') || '');
  if (id) { renderMember(id); return; }
  showIdle();
}

async function init() {
  const config = await Auth.unlockStored();
  if (config) { start(config); return; }
  $('#source').textContent = 'Connexion requise';
  showScreen('login');
  Auth.requireLogin($('#login'), start);
}

$('#logout').addEventListener('click', (e) => {
  e.preventDefault();
  Auth.forget();
  location.href = location.pathname;
});
$('#member').addEventListener('click', (e) => { if (e.target.closest('.share-icon')) shareCard(); });
$('#start').addEventListener('click', startScanner);
$('#photo').addEventListener('change', (e) => { scanPhoto(e.target.files[0]); e.target.value = ''; });
$('#again').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname);
  startScanner();
});
window.addEventListener('pagehide', stopScanner);
document.addEventListener('visibilitychange', () => { if (document.hidden && scanning) { stopScanner(); showIdle(); } });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
})();
