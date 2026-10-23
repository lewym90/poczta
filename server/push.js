// Web Push: klucze VAPID (generowane raz, w data/), wysyłka do urządzeń użytkownika, sprzątanie martwych subskrypcji.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { config } from './config.js';
import { db } from './db.js';

function loadVapid() {
  if (process.env.POCZTA_VAPID_PUBLIC && process.env.POCZTA_VAPID_PRIVATE) return { publicKey: process.env.POCZTA_VAPID_PUBLIC, privateKey: process.env.POCZTA_VAPID_PRIVATE };
  const f = path.join(config.dataDir, 'vapid.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const k = webpush.generateVAPIDKeys();
  fs.writeFileSync(f, JSON.stringify(k), { mode: 0o600 });
  return k;
}
const vapid = loadVapid();
export const vapidPublicKey = () => vapid.publicKey;

const contact = (userId) => `mailto:${db.prepare('SELECT email FROM users WHERE id=?').get(userId)?.email || 'admin@example.com'}`;
const unread = (userId) => db.prepare('SELECT COUNT(*) n FROM messages WHERE user_id=? AND unread=1 AND cat=\'inbox\' AND (snoozed_until IS NULL OR snoozed_until<=?)').get(userId, Date.now()).n;

export async function sendToUser(userId, payload) {
  if (process.env.POCZTA_PUSH === '0') return 0;
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id=?').all(userId);
  const body = JSON.stringify({ ...payload, badge: unread(userId) });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86400, urgency: payload.tag === 'test' ? 'normal' : 'high', vapidDetails: { subject: contact(userId), publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id=?').run(s.id); // urządzenie wypisane
    }
  }));
  return sent;
}

// Ustawienia powiadomień użytkownika (tabela flags): tryb 'all' | 'important', ciche godziny "22:00-07:00".
export function getPrefs(userId) {
  const get = (k, d) => db.prepare('SELECT value FROM flags WHERE user_id=? AND key=?').get(userId, k)?.value ?? d;
  return { mode: get('push_mode', 'all'), quiet: get('push_quiet', ''), morning: get('digest_morning', ''), evening: get('digest_evening', '') };
}
export function setPrefs(userId, { mode, quiet, morning, evening }) {
  const put = (k, v) => db.prepare('INSERT INTO flags(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value').run(userId, k, v);
  if (mode !== undefined) { if (!['all', 'important'].includes(mode)) throw new Error('Niepoprawny tryb'); put('push_mode', mode); }
  for (const [k, v] of [['digest_morning', morning], ['digest_evening', evening]]) {
    if (v === undefined) continue;
    if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error('Niepoprawna godzina przeglądu');
    put(k, v);
  }
  if (quiet !== undefined) { if (quiet && !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(quiet)) throw new Error('Niepoprawne ciche godziny'); put('push_quiet', quiet); }
}
export function inQuiet(quiet, now = new Date()) {
  if (!quiet) return false;
  const [a, b] = quiet.split('-');
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: process.env.POCZTA_TZ || 'Europe/Warsaw' }).format(now);
  return a <= b ? t >= a && t < b : t >= a || t < b; // zakres może przechodzić przez północ
}

// nazwa nadawcy z Twoich kontaktów (jeśli jest), inaczej to, co podał nadawca
export const contactName = (userId, addr, fallback) => {
  const r = db.prepare('SELECT c.name FROM contact_emails e JOIN contacts c ON c.id=e.contact_id WHERE e.user_id=? AND e.email=?').get(userId, String(addr || '').toLowerCase());
  return r?.name || fallback;
};
const hhmm = (s) => (s.includes('T') ? s.slice(11, 16) : '');
export async function notifyNewMessages(userId, fresh) {
  const prefs = getPrefs(userId);
  if (inQuiet(prefs.quiet)) return;
  const muted = new Set(db.prepare('SELECT id FROM accounts WHERE user_id=? AND notify=0').all(userId).map((r) => r.id));
  fresh = fresh.map((f) => ({ ...f, fromName: contactName(userId, f.fromAddr, f.fromName) })).filter((f) => !muted.has(f.account_id) && !(prefs.mode === 'important' && !f.items.length));
  if (!fresh.length) return;
  if (fresh.length > 3) return void (await sendToUser(userId, { title: `${fresh.length} nowych wiadomości`, body: fresh.slice(0, 3).map((f) => f.fromName).join(', ') + '…', url: './#/', tag: 'batch' }));
  for (const f of fresh) {
    const it = f.items[0];
    const extra = it ? ` · wykryto ${it.kind === 'parcel' ? 'paczkę' : it.kind === 'deadline' ? 'termin płatności' : 'wydarzenie'}${hhmm(it.starts_at) ? ' ' + hhmm(it.starts_at) : ''}` : '';
    await sendToUser(userId, { title: f.fromName, body: `${f.subject}${extra}`, url: `./#/m/${f.id}`, tag: `m-${f.id}` });
  }
}
