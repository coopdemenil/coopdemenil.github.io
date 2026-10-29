#!/usr/bin/env node
// Génère docs/config.js : l'identifiant du Sheet chiffré avec un mot de passe.
// Usage : node scripts/make-config.mjs '<mot de passe>' <sheetId> [nomOnglet]
// Le Sheet est obligatoire : aucun identifiant n'est écrit en clair dans le dépôt.
// Le mot de passe n'est stocké nulle part : seul le résultat chiffré est écrit.
import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [password, sheetArg, transactionsSheet = 'Transactions'] = process.argv.slice(2);
// Accepte l'identifiant seul ou l'URL complète du Sheet.
const sheetId = (String(sheetArg || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/) || [, sheetArg])[1];
if (!password || password.length < 8 || !/^[a-zA-Z0-9_-]{20,}$/.test(sheetId || '')) {
  console.error("Usage : node scripts/make-config.mjs '<mot de passe, 8 caractères minimum>' <sheetId ou URL du Sheet> [nomOnglet]");
  console.error("Mettre le mot de passe entre guillemets simples pour que le shell n'interprète pas $ ou !.");
  process.exit(1);
}

const ITERATIONS = 310000;
const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64');
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ sheetId, transactionsSheet })));

const out = `// Généré par scripts/make-config.mjs : identifiant du Sheet chiffré (AES-GCM, clé dérivée par PBKDF2).
// Ne contient pas le mot de passe. Regénérer ce fichier pour changer le mot de passe ou le Sheet.
window.COOP_CONFIG = ${JSON.stringify({ iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) }, null, 2)};
`;
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'config.js');
writeFileSync(dest, out);
const n = [...password].length;
const masked = n <= 2 ? '*'.repeat(n) : `${[...password][0]}${'*'.repeat(n - 2)}${[...password][n - 1]}`;
console.log(`docs/config.js écrit (Sheet ${sheetId.slice(0, 8)}…, onglet ${transactionsSheet}).`);
console.log(`Mot de passe chiffré : ${masked} (${n} caractères). Vérifiez que la longueur et les extrémités correspondent.`);
console.log("Testez-le avant de committer : node scripts/check-password.mjs '<mot de passe>'");
console.log('Puis incrémentez la version du cache dans docs/sw.js.');
