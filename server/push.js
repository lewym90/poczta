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
const unread = (userId) => db.prepare('SELECT COUNT(*) n FROM messages WHERE user_id=? AND unread=1').get(userId).n;

export async function sendToUser(userId, payload) {
  if (process.env.POCZTA_PUSH === '0') return 0;
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id=?').all(userId);
  const body = JSON.stringify({ ...payload, badge: unread(userId) });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, urgency: 'normal', vapidDetails: { subject: contact(userId), publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id=?').run(s.id); // urządzenie wypisane
    }
  }));
  return sent;
}

const hhmm = (s) => (s.includes('T') ? s.slice(11, 16) : '');
export async function notifyNewMessages(userId, fresh) {
  if (!fresh.length) return;
  if (fresh.length > 3) return void (await sendToUser(userId, { title: `${fresh.length} nowych wiadomości`, body: fresh.slice(0, 3).map((f) => f.fromName).join(', ') + '…', url: './#/', tag: 'batch' }));
  for (const f of fresh) {
    const it = f.items[0];
    const extra = it ? ` · wykryto ${it.kind === 'parcel' ? 'paczkę' : it.kind === 'deadline' ? 'termin płatności' : 'wydarzenie'}${hhmm(it.starts_at) ? ' ' + hhmm(it.starts_at) : ''}` : '';
    await sendToUser(userId, { title: f.fromName, body: `${f.subject}${extra}`, url: `./#/m/${f.id}`, tag: `m-${f.id}` });
  }
}
