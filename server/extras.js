// Dodatki etapu 8: reguły automatyczne, szablony, kopie zapasowe, widżet (token), klucze dostępu (passkey), logowanie Google, wersja.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, audit } from './db.js';
import { config, secretKey } from './config.js';
import { moveTo, star } from './mailbox.js';

// ---------- reguły automatyczne ----------
export const AUTO_ACTIONS = { archive: 'Archiwizuj', read: 'Oznacz jako przeczytane', star: 'Oznacz gwiazdką', offers: 'Przenieś do Ofert', spam: 'Przenieś do Spamu', trash: 'Przenieś do Kosza' };
const CAT_OF = { archive: 'archive', offers: 'offers', spam: 'spam', trash: 'trash' };
export const loadAutoRules = (uid) => db.prepare('SELECT id,field,value,action FROM auto_rules WHERE user_id=?').all(uid);
export function matchAuto(rules, m) {
  const a = String(m.fromAddr || '').toLowerCase(), d = a.split('@')[1] || '', s = String(m.subject || '').toLowerCase();
  return rules.find((r) => (r.field === 'from' && r.value === a) || (r.field === 'domain' && r.value === d) || (r.field === 'subject' && s.includes(r.value))) || null;
}
export const autoCat = (rule) => CAT_OF[rule?.action] || null;
function applyAutoNow(uid, rule) {
  const col = rule.field === 'from' ? 'lower(from_addr)=?' : rule.field === 'domain' ? "lower(substr(from_addr, instr(from_addr,'@')+1))=?" : "instr(lower(subject), ?)>0";
  const ids = db.prepare(`SELECT id FROM messages WHERE user_id=? AND cat='inbox' AND folder='INBOX' AND ${col}`).all(uid, rule.value).map((r) => r.id);
  if (!ids.length) return 0;
  if (CAT_OF[rule.action]) return moveTo(uid, ids, CAT_OF[rule.action], 'rule').length;
  if (rule.action === 'read') { db.prepare(`UPDATE messages SET unread=0 WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`).run(uid, ...ids); return ids.length; }
  if (rule.action === 'star') return star(uid, ids, true).length;
  return 0;
}

// ---------- kopie zapasowe ----------
const dbPath = () => process.env.POCZTA_DB || path.join(config.dataDir, 'poczta.db');
const bdir = () => path.join(config.dataDir, 'backups');
export function backupList() {
  try { return fs.readdirSync(bdir()).filter((f) => /^poczta-\d{8}-\d{4}\.db$/.test(f)).sort().reverse().map((f) => ({ name: f, size: fs.statSync(path.join(bdir(), f)).size, at: fs.statSync(path.join(bdir(), f)).mtimeMs })); } catch { return []; }
}
export function backupNow(keep = 7) {
  fs.mkdirSync(bdir(), { recursive: true, mode: 0o700 });
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const name = `poczta-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`, file = path.join(bdir(), name);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  fs.chmodSync(file, 0o600);
  for (const old of backupList().slice(keep)) { try { fs.rmSync(path.join(bdir(), old.name)); } catch { /* nic */ } }
  return name;
}
// codziennie około 3:30 (jedna kopia na dobę)
export function dailyBackup(now = new Date()) {
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: process.env.POCZTA_TZ || 'Europe/Warsaw' }).format(now);
  if (t < '03:30' || t > '04:30') return null;
  const last = backupList()[0];
  if (last && now.getTime() - last.at < 20 * 3600e3) return null;
  return backupNow();
}

// ---------- WebAuthn (klucze dostępu), tylko ES256 ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
function cborRead(buf, o = { i: 0 }) {
  const ib = buf[o.i++], mt = ib >> 5; let ai = ib & 31, v;
  const rd = (n) => { let x = 0; for (let k = 0; k < n; k++) x = x * 256 + buf[o.i++]; return x; };
  if (ai < 24) v = ai; else if (ai === 24) v = rd(1); else if (ai === 25) v = rd(2); else if (ai === 26) v = rd(4); else if (ai === 27) v = rd(8); else throw new Error('cbor');
  if (mt === 0) return v;
  if (mt === 1) return -1 - v;
  if (mt === 2) { const r = buf.subarray(o.i, o.i + v); o.i += v; return r; }
  if (mt === 3) { const r = buf.subarray(o.i, o.i + v).toString('utf8'); o.i += v; return r; }
  if (mt === 4) return Array.from({ length: v }, () => cborRead(buf, o));
  if (mt === 5) { const m = new Map(); for (let k = 0; k < v; k++) { const key = cborRead(buf, o); m.set(key, cborRead(buf, o)); } return m; }
  if (mt === 7) return ai === 20 ? false : ai === 21 ? true : null;
  throw new Error('cbor');
}
const challenges = new Map(); // challenge -> { uid, at, kind }
const newChallenge = (uid, kind) => {
  const now = Date.now(); for (const [k, v] of challenges) if (now - v.at > 300e3) challenges.delete(k);
  const c = b64u(crypto.randomBytes(32)); challenges.set(c, { uid, at: now, kind }); return c;
};
const hostOf = (ctx) => String(ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || '').split(',')[0].trim();
function checkClient(ctx, cdJSON, type, kind) {
  const cd = JSON.parse(Buffer.from(cdJSON, 'base64url').toString('utf8'));
  const ch = challenges.get(cd.challenge);
  if (cd.type !== type || !ch || ch.kind !== kind || Date.now() - ch.at > 300e3) throw new Error('Nieprawidłowe wyzwanie, spróbuj ponownie');
  const host = hostOf(ctx), origins = [`https://${host}`, `http://${host}`];
  if (!origins.includes(cd.origin)) throw new Error('Nieprawidłowa domena');
  challenges.delete(cd.challenge);
  return { ch, host: host.replace(/:\d+$/, '') };
}

export function registerExtras({ route, bad, login, rateLimit, isEmail }) {
  const owner = (ctx) => { if (ctx.user.plan !== 'owner') bad('Tylko właściciel', 403); };

  // reguły automatyczne
  route('GET', '/api/auto-rules', (ctx) => ({ rules: db.prepare('SELECT id,field,value,action,hits,created_at FROM auto_rules WHERE user_id=? ORDER BY created_at DESC').all(ctx.user.id), actions: AUTO_ACTIONS }));
  route('POST', '/api/auto-rules', (ctx) => {
    const field = String(ctx.body.field || ''), action = String(ctx.body.action || ''); let value = String(ctx.body.value || '').trim().toLowerCase().slice(0, 120);
    if (!['from', 'domain', 'subject'].includes(field) || !AUTO_ACTIONS[action]) bad('Niepoprawna reguła');
    if (field === 'domain') value = value.replace(/^.*@/, '');
    if (field === 'from' && !isEmail(value)) bad('Podaj poprawny adres nadawcy');
    if (field === 'subject' && value.length < 3) bad('Fragment tematu musi mieć co najmniej 3 znaki');
    if (!value) bad('Podaj wartość reguły');
    if (db.prepare('SELECT COUNT(*) n FROM auto_rules WHERE user_id=?').get(ctx.user.id).n >= 100) bad('Limit 100 reguł');
    db.prepare('INSERT INTO auto_rules(user_id,field,value,action,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,field,value) DO UPDATE SET action=excluded.action').run(ctx.user.id, field, value, action, Date.now());
    const rule = db.prepare('SELECT id,field,value,action FROM auto_rules WHERE user_id=? AND field=? AND value=?').get(ctx.user.id, field, value);
    const applied = ctx.body.apply ? applyAutoNow(ctx.user.id, rule) : 0;
    audit(ctx.user.id, 'auto_rule', `${field}:${value}:${action}`);
    return { rule, applied };
  });
  route('DELETE', '/api/auto-rules/:id', (ctx) => { db.prepare('DELETE FROM auto_rules WHERE id=? AND user_id=?').run(+ctx.params.id, ctx.user.id); return { ok: true }; });

  // szablony odpowiedzi
  route('GET', '/api/templates', (ctx) => ({ templates: db.prepare('SELECT id,name,body FROM templates WHERE user_id=? ORDER BY name COLLATE NOCASE').all(ctx.user.id) }));
  route('POST', '/api/templates', (ctx) => {
    const name = String(ctx.body.name || '').trim().slice(0, 40), body = String(ctx.body.body || '').trim().slice(0, 2000);
    if (!name || !body) bad('Podaj nazwę i treść szablonu');
    const id = +ctx.body.id || 0;
    if (id) { db.prepare('UPDATE templates SET name=?, body=? WHERE id=? AND user_id=?').run(name, body, id, ctx.user.id); return { ok: true, id }; }
    if (db.prepare('SELECT COUNT(*) n FROM templates WHERE user_id=?').get(ctx.user.id).n >= 30) bad('Limit 30 szablonów');
    const r = db.prepare('INSERT INTO templates(user_id,name,body,created_at) VALUES(?,?,?,?)').run(ctx.user.id, name, body, Date.now());
    return { ok: true, id: Number(r.lastInsertRowid) };
  });
  route('DELETE', '/api/templates/:id', (ctx) => { db.prepare('DELETE FROM templates WHERE id=? AND user_id=?').run(+ctx.params.id, ctx.user.id); return { ok: true }; });

  // kopie zapasowe (właściciel)
  route('GET', '/api/backup', (ctx) => { owner(ctx); return { files: backupList(), keyHint: String(secretKey || '').length > 0, dir: bdir() }; });
  route('POST', '/api/backup/run', (ctx) => { owner(ctx); if (!rateLimit(`bk:${ctx.user.id}`, 6, 3600e3)) bad('Za często', 429); const name = backupNow(); audit(ctx.user.id, 'backup', name); return { name, files: backupList() }; });
  route('GET', '/api/backup/file', (ctx) => {
    owner(ctx); const name = String(ctx.query.get('name') || '');
    if (!/^poczta-\d{8}-\d{4}\.db$/.test(name) || !fs.existsSync(path.join(bdir(), name))) bad('Nie ma takiej kopii', 404);
    audit(ctx.user.id, 'backup_download', name);
    ctx.raw = { type: 'application/octet-stream', body: fs.readFileSync(path.join(bdir(), name)), headers: { 'Content-Disposition': `attachment; filename="${name}"` } };
  });
  route('GET', '/api/backup/key', (ctx) => {
    owner(ctx); if (!rateLimit(`bkkey:${ctx.user.id}`, 5, 3600e3)) bad('Za często', 429);
    audit(ctx.user.id, 'key_download');
    ctx.raw = { type: 'text/plain; charset=utf-8', body: Buffer.from(`POCZTA_SECRET_KEY=${Buffer.from(secretKey).toString('hex')}\n`), headers: { 'Content-Disposition': 'attachment; filename="poczta-klucz.txt"' } };
  });

  // widżet: osobny token tylko do odczytu podsumowania (Scriptable / Skróty)
  const flag = (uid, k) => db.prepare('SELECT value FROM flags WHERE user_id=? AND key=?').get(uid, k)?.value || '';
  route('GET', '/api/widget/token', (ctx) => ({ token: flag(ctx.user.id, 'widget_token') }));
  route('POST', '/api/widget/token', (ctx) => {
    const t = ctx.body.off ? '' : b64u(crypto.randomBytes(24));
    db.prepare("INSERT INTO flags(user_id,key,value) VALUES(?,'widget_token',?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run(ctx.user.id, t); return { token: t };
  });
  route('GET', '/api/widget', (ctx) => {
    if (!rateLimit(`wd:${ctx.ip}`, 60, 60e3)) bad('Za często', 429);
    const tok = String(ctx.query.get('token') || ''); if (tok.length < 20) bad('Brak tokenu', 401);
    const row = db.prepare("SELECT user_id FROM flags WHERE key='widget_token' AND value=?").get(tok) || bad('Zły token', 401);
    const uid = row.user_id, now = Date.now(), today = new Date().toISOString().slice(0, 10);
    const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE user_id=? AND cat='inbox' AND unread=1 AND (snoozed_until IS NULL OR snoozed_until<=?)").get(uid, now).n;
    const open = db.prepare("SELECT kind,title,starts_at,amount FROM found_items WHERE user_id=? AND status='new' ORDER BY starts_at LIMIT 20").all(uid);
    const next = open[0] || null, due = open.filter((i) => i.kind === 'deadline' && i.amount && i.starts_at.slice(0, 10) <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).reduce((t, i) => t + i.amount, 0);
    return { unread, open: open.length, next: next ? { title: next.title, at: next.starts_at } : null, due_week: Math.round(due * 100) / 100, today };
  }, { auth: false });

  // wersja i aktualizacje
  route('GET', '/api/version', () => {
    let v = ''; try { v = fs.readFileSync(process.env.POCZTA_VERSION_FILE || '/opt/poczta/.version', 'utf8').trim(); } catch { /* wersja deweloperska */ }
    return { version: v ? v.slice(0, 8) : 'dev', auto: !!v };
  });

  // klucze dostępu
  route('GET', '/api/passkeys', (ctx) => ({ keys: db.prepare('SELECT id,name,created_at FROM passkeys WHERE user_id=? ORDER BY id').all(ctx.user.id) }));
  route('DELETE', '/api/passkeys/:id', (ctx) => { db.prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(+ctx.params.id, ctx.user.id); return { ok: true }; });
  route('POST', '/api/passkey/register/options', (ctx) => {
    const host = hostOf(ctx).replace(/:\d+$/, '');
    return { challenge: newChallenge(ctx.user.id, 'reg'), rp: { id: host, name: 'Poczta' }, user: { id: b64u(`u${ctx.user.id}`), name: ctx.user.email, displayName: ctx.user.email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: 60000, attestation: 'none',
      excludeCredentials: db.prepare('SELECT cred_id FROM passkeys WHERE user_id=?').all(ctx.user.id).map((k) => ({ type: 'public-key', id: k.cred_id })) };
  });
  route('POST', '/api/passkey/register/verify', (ctx) => {
    try {
      const { response } = ctx.body, { ch, host } = checkClient(ctx, response.clientDataJSON, 'webauthn.create', 'reg');
      if (ch.uid !== ctx.user.id) throw new Error('Nieprawidłowa sesja');
      const att = cborRead(Buffer.from(response.attestationObject, 'base64url')), ad = att.get('authData');
      if (!ad.subarray(0, 32).equals(crypto.createHash('sha256').update(host).digest())) throw new Error('Niezgodna domena');
      if (!(ad[32] & 1) || !(ad[32] & 0x40)) throw new Error('Brak potwierdzenia użytkownika');
      const len = ad.readUInt16BE(53), credId = ad.subarray(55, 55 + len), cose = cborRead(ad, { i: 55 + len });
      if (cose.get(3) !== -7 || cose.get(1) !== 2) throw new Error('Obsługujemy tylko klucze ES256');
      const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) }, format: 'jwk' }).export({ type: 'spki', format: 'der' });
      db.prepare('INSERT INTO passkeys(user_id,cred_id,pub,counter,name,created_at) VALUES(?,?,?,?,?,?)').run(ctx.user.id, b64u(credId), pub.toString('base64'), ad.readUInt32BE(33), String(ctx.body.name || 'Ten telefon').slice(0, 40), Date.now());
      audit(ctx.user.id, 'passkey_added'); return { ok: true };
    } catch (e) { bad(e.message || 'Nie udało się dodać klucza'); }
  });
  route('POST', '/api/passkey/login/options', (ctx) => {
    if (!rateLimit(`pk:${ctx.ip}`, 20, 600e3)) bad('Za dużo prób', 429);
    return { challenge: newChallenge(0, 'auth'), rpId: hostOf(ctx).replace(/:\d+$/, ''), userVerification: 'required', timeout: 60000 };
  }, { auth: false });
  route('POST', '/api/passkey/login/verify', (ctx) => {
    if (!rateLimit(`pkv:${ctx.ip}`, 20, 600e3)) bad('Za dużo prób', 429);
    try {
      const { id, response } = ctx.body, { host } = checkClient(ctx, response.clientDataJSON, 'webauthn.get', 'auth');
      const k = db.prepare('SELECT * FROM passkeys WHERE cred_id=?').get(String(id)) || (() => { throw new Error('Nieznany klucz'); })();
      const ad = Buffer.from(response.authenticatorData, 'base64url');
      if (!ad.subarray(0, 32).equals(crypto.createHash('sha256').update(host).digest()) || !(ad[32] & 1) || !(ad[32] & 4)) throw new Error('Niezgodne dane klucza');
      const data = Buffer.concat([ad, crypto.createHash('sha256').update(Buffer.from(response.clientDataJSON, 'base64url')).digest()]);
      if (!crypto.verify('sha256', data, { key: Buffer.from(k.pub, 'base64'), format: 'der', type: 'spki' }, Buffer.from(response.signature, 'base64url'))) throw new Error('Zły podpis');
      const cnt = ad.readUInt32BE(33); if (cnt && cnt <= k.counter) throw new Error('Powtórzone użycie klucza');
      db.prepare('UPDATE passkeys SET counter=? WHERE id=?').run(cnt, k.id);
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(k.user_id); audit(u.id, 'login_passkey', ctx.ip);
      return login(ctx, u.id, u.email, u.plan);
    } catch (e) { audit(null, 'passkey_failed', ctx.ip); bad(e.message || 'Nie udało się zalogować', 401); }
  }, { auth: false });

  // logowanie kontem Google: tylko dla istniejących użytkowników o tym samym zweryfikowanym adresie
  route('GET', '/api/auth-config', () => ({ google: process.env.GOOGLE_CLIENT_ID || '' }), { auth: false });
  route('POST', '/api/google/login', async (ctx) => {
    if (!process.env.GOOGLE_CLIENT_ID) bad('Logowanie Google nie jest włączone', 404);
    if (!rateLimit(`gl:${ctx.ip}`, 10, 600e3)) bad('Za dużo prób', 429);
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(ctx.body.credential || ''))}`).then((x) => x.json()).catch(() => ({}));
    if (r.aud !== process.env.GOOGLE_CLIENT_ID || r.email_verified !== 'true' || !r.email) bad('Nie udało się potwierdzić konta Google', 401);
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(r.email).toLowerCase()) || bad('Ten adres Google nie ma konta w Poczcie', 403);
    audit(u.id, 'login_google', ctx.ip); return login(ctx, u.id, u.email, u.plan);
  }, { auth: false });
}
