// Szyfrowanie sekretów, hasła, sesje, ochrona przed SSRF.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { secretKey } from './config.js';
import { db } from './db.js';

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob) {
  const [iv, tag, ct] = String(blob).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', secretKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [v, s, h] = String(stored).split('$');
  if (v !== 's1') return false;
  const calc = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(h, 'base64');
  return want.length === calc.length && crypto.timingSafeEqual(want, calc);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SESSION_MS = 1000 * 60 * 60 * 24 * 60;
export function createSession(userId, ua = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(id,user_id,expires,ua) VALUES(?,?,?,?)').run(sha(token), userId, Date.now() + SESSION_MS, String(ua).slice(0, 200));
  return token;
}
export function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT u.id,u.email,u.plan,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(sha(token));
  if (!row || row.expires < Date.now()) return null;
  return { id: row.id, email: row.email, plan: row.plan };
}
export const destroySession = (token) => token && db.prepare('DELETE FROM sessions WHERE id=?').run(sha(token));

// Proste ograniczanie prób logowania (w pamięci, per IP).
const tries = new Map();
export function rateLimit(key, max = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const arr = (tries.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); tries.set(key, arr);
  return arr.length <= max;
}

// Użytkownik podaje host serwera poczty: nie pozwalamy na adresy prywatne (SSRF).
export async function assertPublicHost(host) {
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error('Nieprawidłowy adres serwera');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  for (const { address } of addrs) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) || address === '::1' || /^f[cd]/i.test(address) || /^fe80/i.test(address))
      throw new Error('Adres serwera wskazuje na sieć prywatną');
  }
}
