#!/usr/bin/env node
// Vérifie qu'un mot de passe déverrouille docs/config.js, sans rien modifier.
// Usage : node scripts/check-password.mjs '<mot de passe>'
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const password = process.argv[2];
if (!password) {
  console.error("Usage : node scripts/check-password.mjs '<mot de passe>'  (guillemets simples)");
  process.exit(1);
}
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'config.js'), 'utf8');
const cfg = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const b = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt: b(cfg.salt), iterations: cfg.iterations, hash: 'SHA-256' },
  base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
try {
  const plain = JSON.parse(new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(cfg.iv) }, key, b(cfg.data))));
  console.log(`OK : ce mot de passe (${[...password].length} caractères) ouvre l'app. Sheet ${plain.sheetId.slice(0, 8)}…, onglet ${plain.transactionsSheet}.`);
} catch {
  console.log(`REFUSÉ : ce mot de passe (${[...password].length} caractères) n'ouvre pas docs/config.js.`);
  process.exit(2);
}
