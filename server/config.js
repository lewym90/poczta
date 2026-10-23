// Konfiguracja z zmiennych środowiskowych (jedno miejsce, bez twardych wartości w kodzie).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

export const config = {
  root,
  base: (env.POCZTA_BASE || '/').replace(/\/?$/, '/'),
  port: parseInt(env.POCZTA_PORT || '8792', 10),
  host: env.POCZTA_HOST || '127.0.0.1',
  dataDir: path.resolve(env.POCZTA_DATA || path.join(root, 'data')),
  webDir: path.join(root, 'web'),
  kalendarzUrl: (env.KALENDARZ_URL || 'https://lewym90.github.io/kalendarz/').replace(/\/?$/, '/'),
  // Tenant-ready: ile kont użytkowników można założyć. 1 = tylko właściciel (domyślnie).
  maxUsers: parseInt(env.POCZTA_MAX_USERS || '1', 10), // dotyczy tylko instalacji pierwszego konta właściciela
  maxGuests: parseInt(env.POCZTA_MAX_GUESTS || '3', 10), // ile osób właściciel może zaprosić
  guestMaxAccounts: parseInt(env.POCZTA_GUEST_ACCOUNTS || '3', 10),
  syncEverySec: parseInt(env.POCZTA_SYNC_SEC || '120', 10),
  secureCookie: env.POCZTA_SECURE_COOKIE !== '0' && env.NODE_ENV === 'production',
  demoAllowed: env.POCZTA_DEMO !== '0',
};

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

// Klucz szyfrowania sekretów (hasła aplikacji). Z env albo wygenerowany raz i zapisany w data/.
function loadKey() {
  if (env.POCZTA_SECRET_KEY && /^[0-9a-f]{64}$/i.test(env.POCZTA_SECRET_KEY)) return Buffer.from(env.POCZTA_SECRET_KEY, 'hex');
  const f = path.join(config.dataDir, 'secret.key');
  if (fs.existsSync(f)) return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  const k = crypto.randomBytes(32);
  fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 });
  return k;
}
export const secretKey = loadKey();
