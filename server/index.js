// Poczta: serwer API + statyczna aplikacja PWA. Jeden proces, brak zewnętrznych usług.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, audit } from './db.js';
import { encrypt, hashPassword, verifyPassword, createSession, sessionUser, destroySession, rateLimit } from './security.js';
import { providers, syncAccount, startScheduler, onEvent, accountSecret, watchAccount, unwatchAccount, watching } from './sync.js';
import { mark, restore, emptyFolder, purgeTrash, reclassifyAll, counts, loadRules, addRule, applyRuleNow, initialSort } from './mailbox.js';
import { serverDeleteOn } from './jobs.js';
import zlib from 'node:zlib';
import { cleanHtml, frameDoc } from './intel/mailhtml.js';
import { fetchImage } from './imgproxy.js';
import { vapidPublicKey, sendToUser, getPrefs, setPrefs } from './push.js';
import { presetFor } from './providers/presets.js';
import { calendarLink, buildIcs } from './calendar.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg, code = 400) => { throw new HttpError(code, msg); };

const json = (res, code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...HEADERS, ...extra }); res.end(JSON.stringify(obj)); };
const readBody = (req, limit = 1_000_000) => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, 'Za duże żądanie')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Niepoprawny JSON')); } });
  req.on('error', reject);
});
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const sessionCookie = (token, maxAge) => `sid=${token}; Path=${config.base}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secureCookie ? '; Secure' : ''}`;
const isEmail = (s) => typeof s === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s) && s.length < 255;

// ---- logika list i urgency ----
const parseLocal = (s) => { const [d, t = '00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi).getTime(); };
function urgency(nextAt) {
  if (!nextAt) return 'no';
  const dt = parseLocal(nextAt) - Date.now();
  return dt < 36 * 3600e3 ? 'hi' : dt < 8 * 86400e3 ? 'md' : 'lo';
}
function withItems(uid, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const items = db.prepare(`SELECT id,message_id,kind,title,starts_at,ends_at,all_day,amount,currency,location,confidence,source,status FROM found_items WHERE user_id=? AND status IN ('new','added') AND message_id IN (${ids.map(() => '?').join(',')}) ORDER BY starts_at`).all(uid, ...ids);
  const by = new Map();
  for (const it of items) { if (!by.has(it.message_id)) by.set(it.message_id, []); by.get(it.message_id).push(it); }
  return rows.map((r) => { const its = by.get(r.id) || []; const open = its.filter((i) => i.status === 'new'); return { ...r, unread: !!r.unread, has_attach: !!r.has_attach, items: its, open_items: open.length, urgency: urgency(open[0]?.starts_at) }; });
}
const MSG_COLS = 'm.id,m.account_id,m.from_name,m.from_addr,m.subject,m.snippet,m.date,m.unread,m.has_attach,m.risk,m.snoozed_until,m.woke_at,m.cat,m.cat_why';

function ftsQuery(q) {
  const toks = String(q).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  return toks.slice(0, 8).map((t) => `"${t}"*`).join(' ');
}

// ---- trasy ----
const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, auth });

route('GET', '/zdrowie', () => ({ ok: true, app: 'poczta' }), { auth: false });
route('GET', '/api/state', (ctx) => ({ user: ctx.user, setupNeeded: db.prepare('SELECT COUNT(*) n FROM users').get().n < config.maxUsers && !ctx.user, demoAllowed: config.demoAllowed }), { auth: false });

route('POST', '/api/setup', async (ctx) => {
  const { email, password, code } = ctx.body;
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n >= config.maxUsers) bad('Rejestracja jest zamknięta', 403);
  if (process.env.POCZTA_SETUP_CODE && code !== process.env.POCZTA_SETUP_CODE) { if (!rateLimit(`setup:${ctx.ip}`, 5)) bad('Za dużo prób', 429); bad('Niepoprawny kod instalacji', 403); }
  if (!isEmail(email)) bad('Podaj poprawny adres e-mail');
  if (typeof password !== 'string' || password.length < 10) bad('Hasło musi mieć co najmniej 10 znaków');
  const r = db.prepare('INSERT INTO users(email,pass_hash,created_at) VALUES(?,?,?)').run(email.toLowerCase(), hashPassword(password), Date.now());
  audit(Number(r.lastInsertRowid), 'user_created', email);
  return login(ctx, Number(r.lastInsertRowid), email.toLowerCase());
}, { auth: false });

function login(ctx, id, email) {
  const token = createSession(id, ctx.req.headers['user-agent']);
  ctx.headers['Set-Cookie'] = sessionCookie(token, 60 * 86400);
  return { user: { id, email } };
}
route('POST', '/api/login', async (ctx) => {
  if (!rateLimit(`login:${ctx.ip}`, 8)) bad('Za dużo prób. Spróbuj za kilka minut.', 429);
  const { email, password } = ctx.body;
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase());
  if (!u || !verifyPassword(String(password || ''), u.pass_hash)) { audit(u?.id, 'login_failed', ctx.ip); bad('Niepoprawny e-mail lub hasło', 401); }
  audit(u.id, 'login', ctx.ip);
  return login(ctx, u.id, u.email);
}, { auth: false });
route('POST', '/api/logout', (ctx) => { destroySession(ctx.token); ctx.headers['Set-Cookie'] = sessionCookie('', 0); return { ok: true }; });

// konta
// Jednorazowo usuwa z już zapisanych wiadomości znaczniki "[image: ...]" z podglądów i treści.
for (const r of db.prepare("SELECT id,snippet,body FROM messages WHERE snippet LIKE '%[image:%' OR body LIKE '%[image:%'").all()) {
  const clean = (t) => String(t || '').replace(/\[(?:image|obraz|logo)[^\]\n]{0,80}\]/gi, '').replace(/ {2,}/g, ' ');
  db.prepare('UPDATE messages SET snippet=?, body=? WHERE id=?').run(clean(r.snippet).trim(), clean(r.body), r.id);
}
const publicAcc = (a) => ({ id: a.id, label: a.label, provider: a.provider, email: a.email, live: watching(a.id), notify: !!a.notify, status: a.status, last_sync: a.last_sync, last_error: a.last_error, count: db.prepare('SELECT COUNT(*) n FROM messages WHERE account_id=?').get(a.id).n });
route('GET', '/api/accounts', (ctx) => ({ accounts: db.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY id').all(ctx.user.id).map(publicAcc) }));
route('GET', '/api/presets', (ctx) => { const p = presetFor(ctx.query.get('email') || ''); return { preset: p ? { name: p.name, note: p.note } : null }; });
route('POST', '/api/accounts', async (ctx) => {
  const { email, password } = ctx.body;
  if (!isEmail(email)) bad('Podaj poprawny adres e-mail');
  if (typeof password !== 'string' || !password) bad('Podaj hasło (dla Gmaila: hasło aplikacji)');
  const p = presetFor(email);
  const num = (v, d) => (Number.isInteger(+v) && +v > 0 && +v < 65536 ? +v : d);
  const imapHost = String(ctx.body.imapHost || p?.imap[0] || '').trim(), smtpHost = String(ctx.body.smtpHost || p?.smtp[0] || '').trim();
  if (!imapHost) bad('Nie znam serwera tej skrzynki. Podaj adres serwera IMAP.');
  const cfg = {
    user: String(ctx.body.user || email).trim(),
    imap: { host: imapHost, port: num(ctx.body.imapPort, p?.imap[1] || 993), secure: ctx.body.imapSecure ?? p?.imap[2] ?? true },
    smtp: smtpHost ? { host: smtpHost, port: num(ctx.body.smtpPort, p?.smtp[1] || 465), secure: ctx.body.smtpSecure ?? p?.smtp[2] ?? true } : null,
  };
  if (db.prepare('SELECT COUNT(*) n FROM accounts WHERE user_id=?').get(ctx.user.id).n >= 10) bad('Limit 10 kont');
  try { await providers.imap.test({ ...cfg, email }, password); }
  catch (e) { bad(`Nie udało się zalogować: ${String(e.responseText || e.message).slice(0, 160)}`, 422); }
  const r = db.prepare('INSERT INTO accounts(user_id,label,provider,email,config,secret_enc,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(ctx.user.id, String(ctx.body.label || p?.name || email).slice(0, 40), 'imap', email.toLowerCase(), JSON.stringify(cfg), encrypt(password), Date.now());
  audit(ctx.user.id, 'account_added', email);
  const id = Number(r.lastInsertRowid);
  syncAccount(id).then(() => watchAccount(id));
  return { account: publicAcc(db.prepare('SELECT * FROM accounts WHERE id=?').get(id)) };
});
route('POST', '/api/accounts/demo', async (ctx) => {
  if (!config.demoAllowed) bad('Tryb demo jest wyłączony', 403);
  if (db.prepare("SELECT 1 FROM accounts WHERE user_id=? AND provider='demo'").get(ctx.user.id)) bad('Konto demo już istnieje');
  const r = db.prepare('INSERT INTO accounts(user_id,label,provider,email,config,created_at) VALUES(?,?,?,?,?,?)').run(ctx.user.id, 'Demo', 'demo', 'demo@poczta.local', '{}', Date.now());
  await syncAccount(Number(r.lastInsertRowid));
  return { ok: true };
});
route('POST', '/api/accounts/:id/sync', async (ctx) => {
  const a = db.prepare('SELECT id FROM accounts WHERE id=? AND user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiego konta', 404);
  const r = await syncAccount(a.id); return { ok: !!r, ...r };
});
route('DELETE', '/api/accounts/:id', (ctx) => {
  const r = db.prepare('DELETE FROM accounts WHERE id=? AND user_id=?').run(+ctx.params.id, ctx.user.id);
  if (!r.changes) bad('Nie ma takiego konta', 404);
  unwatchAccount(+ctx.params.id);
  db.exec("DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages)");
  audit(ctx.user.id, 'account_removed', ctx.params.id); return { ok: true };
});

// wiadomości
route('GET', '/api/messages', (ctx) => {
  const q = ctx.query, uid = ctx.user.id;
  const tab = q.get('tab') || 'all', limit = Math.min(+q.get('limit') || 40, 100), before = +q.get('before') || 0, acc = +q.get('account') || 0;
  const where = ['m.user_id=?']; const args = [uid];
  if (acc) { where.push('m.account_id=?'); args.push(acc); }
  if (before) { where.push('m.date<?'); args.push(before); }
  const now = Date.now();
  const FOLDERS = { offers: 'offers', spam: 'spam', trash: 'trash' };
  if (FOLDERS[tab]) where.push('m.cat=?'), args.push(FOLDERS[tab]);
  else {
    where.push("m.cat='inbox'");
    if (tab === 'snoozed') { where.push('m.snoozed_until>?'); args.push(now); }
    else { where.push('(m.snoozed_until IS NULL OR m.snoozed_until<=?)'); args.push(now); }
  }
  if (tab === 'unread') where.push('m.unread=1');
  if (tab === 'action') where.push("EXISTS(SELECT 1 FROM found_items f WHERE f.message_id=m.id AND f.status='new')");
  if (tab === 'dates') where.push("EXISTS(SELECT 1 FROM found_items f WHERE f.message_id=m.id AND f.status IN ('new','added'))");
  const rows = db.prepare(`SELECT ${MSG_COLS} FROM messages m WHERE ${where.join(' AND ')} ORDER BY MAX(m.date, COALESCE(m.woke_at,0)) DESC LIMIT ?`).all(...args, limit);
  const total = db.prepare("SELECT SUM(unread) u FROM messages WHERE user_id=? AND cat='inbox' AND (snoozed_until IS NULL OR snoozed_until<=?)").get(uid, now);
  const cn = counts(uid);
  return { messages: withItems(uid, rows), unread: total.u || 0, snoozed: cn.snoozed, counts: cn };
});
const imagesOn = (uid) => (db.prepare("SELECT value FROM flags WHERE user_id=? AND key='images'").get(uid)?.value ?? '1') === '1';
route('GET', '/api/messages/:id', async (ctx) => {
  const m = db.prepare('SELECT m.*,a.email AS account_email,a.label AS account_label,a.provider AS account_provider FROM messages m JOIN accounts a ON a.id=m.account_id WHERE m.id=? AND m.user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiej wiadomości', 404);
  const items = db.prepare("SELECT * FROM found_items WHERE message_id=? AND user_id=? AND status!='dismissed' ORDER BY starts_at").all(m.id, ctx.user.id).map((i) => ({ ...i, link: calendarLink(i) }));
  // oryginalny HTML: zapisany przy pobraniu, a dla starszych wiadomości dociągany raz z serwera poczty
  let rawHtml = m.html_z ? zlib.inflateSync(m.html_z).toString('utf8') : '';
  if (!rawHtml && !m.html_try && m.account_provider === 'imap') {
    db.prepare('UPDATE messages SET html_try=1 WHERE id=?').run(m.id);
    const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(m.account_id);
    try {
      rawHtml = await Promise.race([providers.imap.fetchHtml({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), m.uid), new Promise((_, rej) => setTimeout(() => rej(new Error('czas')), 15000))]);
      if (rawHtml) db.prepare('UPDATE messages SET html_z=? WHERE id=?').run(zlib.deflateSync(Buffer.from(rawHtml)), m.id);
    } catch { rawHtml = ''; }
  }
  const pref = imagesOn(ctx.user.id), images = pref || ctx.query.get('images') === '1';
  const cleaned = rawHtml ? cleanHtml(rawHtml, { images }) : null;
  return { message: { id: m.id, account_id: m.account_id, account_email: m.account_email, account_label: m.account_label, from_name: m.from_name, from_addr: m.from_addr, to_addr: m.to_addr, subject: m.subject, body: m.body, date: m.date, unread: !!m.unread, risk: m.risk, risk_reasons: m.risk_reasons ? JSON.parse(m.risk_reasons) : [], has_attach: !!m.has_attach, message_id: m.message_id, snoozed_until: m.snoozed_until, cat: m.cat, cat_why: m.cat_why,
    frame: cleaned ? frameDoc(cleaned.html) : null, remote_images: cleaned ? cleaned.remote : 0, images_blocked: !!(cleaned && cleaned.remote && !images) }, items };
});
route('GET', '/api/img', async (ctx) => {
  if (!rateLimit(`img:${ctx.user.id}`, 900, 300e3)) bad('Za dużo obrazków naraz', 429);
  const u = ctx.query.get('u') || ''; if (!/^https?:\/\//i.test(u) || u.length > 2000) bad('Zły adres obrazka');
  let r; try { r = await fetchImage(u); } catch (e) { bad('Nie udało się pobrać obrazka', 502); }
  ctx.raw = { type: r.type, body: r.buf, headers: { 'Cache-Control': 'private, max-age=604800', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' } };
});
route('POST', '/api/messages/:id/read', async (ctx) => {
  const m = db.prepare('SELECT m.id,m.uid,m.account_id FROM messages m WHERE m.id=? AND m.user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiej wiadomości', 404);
  const read = ctx.body.read !== false;
  db.prepare('UPDATE messages SET unread=? WHERE id=?').run(read ? 0 : 1, m.id);
  const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(m.account_id);
  if (acc && acc.provider !== 'demo') providers[acc.provider].setSeen({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), m.uid, read).catch(() => {});
  return { ok: true };
});
route('POST', '/api/messages/:id/snooze', (ctx) => {
  const until = ctx.body.until === null ? null : Number(ctx.body.until);
  if (until !== null && (!Number.isFinite(until) || until < Date.now() + 30e3 || until > Date.now() + 366 * 86400e3)) bad('Wybierz termin w przyszłości (do roku)');
  const r = db.prepare('UPDATE messages SET snoozed_until=? WHERE id=? AND user_id=?').run(until, +ctx.params.id, ctx.user.id);
  if (!r.changes) bad('Nie ma takiej wiadomości', 404);
  audit(ctx.user.id, until ? 'snooze' : 'unsnooze', ctx.params.id); return { ok: true, until };
});
// porządkowanie: usuń / spam / oferty / zablokuj / przywróć (jedna trasa, także zbiorczo)
route('POST', '/api/messages/act', (ctx) => {
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : [];
  if (!ids.length || ids.length > 1000) bad('Nie wskazano wiadomości');
  let done; try { done = mark(ctx.user.id, ids, String(ctx.body.action), ctx.body.scope === 'domain' ? 'domain' : 'sender'); } catch (e) { bad(e.message); }
  return { ok: true, ids: done, count: done.length };
});
route('POST', '/api/folders/:cat/empty', (ctx) => {
  if (ctx.params.cat === 'trash') return { ok: true, count: purgeTrash(ctx.user.id), ids: [] };
  let ids; try { ids = emptyFolder(ctx.user.id, ctx.params.cat); } catch (e) { bad(e.message); }
  return { ok: true, count: ids.length, ids };
});
route('GET', '/api/rules', (ctx) => ({ rules: db.prepare('SELECT id,kind,value,action,created_at FROM rules WHERE user_id=? ORDER BY created_at DESC').all(ctx.user.id), serverDelete: serverDeleteOn(ctx.user.id), images: imagesOn(ctx.user.id), counts: counts(ctx.user.id) }));
route('DELETE', '/api/rules/:id', (ctx) => {
  const r = db.prepare('SELECT * FROM rules WHERE id=? AND user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiej reguły', 404);
  db.prepare('DELETE FROM rules WHERE id=?').run(r.id);
  if (r.action !== 'block') { reclassifyAll(ctx.user.id); }
  audit(ctx.user.id, 'rule_removed', `${r.kind}:${r.value}`); return { ok: true };
});
route('POST', '/api/organize', (ctx) => {
  if (ctx.body.serverDelete !== undefined) db.prepare("INSERT INTO flags(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run(ctx.user.id, 'server_delete', ctx.body.serverDelete ? '1' : '0');
  if (ctx.body.images !== undefined) db.prepare("INSERT INTO flags(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run(ctx.user.id, 'images', ctx.body.images ? '1' : '0');
  const changed = ctx.body.reclassify ? reclassifyAll(ctx.user.id) : 0;
  return { ok: true, changed, serverDelete: serverDeleteOn(ctx.user.id), images: imagesOn(ctx.user.id) };
});
route('GET', '/api/search', (ctx) => {
  const fq = ftsQuery(ctx.query.get('q') || '');
  if (!fq) return { messages: [] };
  const rows = db.prepare(`SELECT ${MSG_COLS} FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH ? AND m.user_id=? AND m.cat IN ('inbox','offers') ORDER BY m.date DESC LIMIT 40`).all(fq, ctx.user.id);
  return { messages: withItems(ctx.user.id, rows) };
});
route('POST', '/api/send', async (ctx) => {
  if (!rateLimit(`send:${ctx.user.id}`, 30, 3600e3)) bad('Limit wysyłki: 30 wiadomości na godzinę', 429);
  const { account_id, to, subject, text, in_reply_to } = ctx.body;
  const acc = db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(+account_id, ctx.user.id) || bad('Wybierz konto nadawcy');
  const rcpt = String(to || '').split(/[,;]\s*/).filter(Boolean);
  if (!rcpt.length || rcpt.length > 20 || !rcpt.every(isEmail)) bad('Niepoprawny adres odbiorcy');
  if (!String(text || '').trim()) bad('Wiadomość jest pusta');
  const cfg = JSON.parse(acc.config);
  if (acc.provider !== 'demo' && !cfg.smtp) bad('To konto nie ma skonfigurowanego serwera wysyłki (SMTP)');
  await providers[acc.provider].send({ ...cfg, email: acc.email }, accountSecret(acc), { from: acc.email, to: rcpt.join(', '), subject: String(subject || '').slice(0, 250), text: String(text).slice(0, 200000), inReplyTo: in_reply_to });
  audit(ctx.user.id, 'sent', `${acc.email} -> ${rcpt.length}`);
  return { ok: true };
});

// sprawy
route('GET', '/api/items', (ctx) => {
  const st = ctx.query.get('status') || 'new';
  const rows = db.prepare(`SELECT f.*,m.subject,m.from_name,m.id AS mid FROM found_items f JOIN messages m ON m.id=f.message_id WHERE f.user_id=? AND f.status=? ORDER BY f.starts_at LIMIT 200`).all(ctx.user.id, st);
  return { items: rows.map((i) => ({ ...i, link: calendarLink(i) })) };
});
route('POST', '/api/items/:id', (ctx) => {
  const st = ctx.body.status;
  if (!['new', 'added', 'dismissed', 'paid'].includes(st)) bad('Niepoprawny status');
  const r = db.prepare('UPDATE found_items SET status=?, resolved_at=? WHERE id=? AND user_id=?').run(st, st === 'new' ? null : Date.now(), +ctx.params.id, ctx.user.id);
  if (!r.changes) bad('Nie ma takiej sprawy', 404);
  audit(ctx.user.id, `item_${st}`, ctx.params.id);
  return { ok: true };
});
route('GET', '/api/items/:id/ics', (ctx) => {
  const it = db.prepare('SELECT * FROM found_items WHERE id=? AND user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiej sprawy', 404);
  ctx.raw = { type: 'text/calendar; charset=utf-8', body: buildIcs(it), headers: { 'Content-Disposition': `attachment; filename="poczta-${it.id}.ics"` } };
});
route('GET', '/api/obligations', (ctx) => {
  const uid = ctx.user.id, now = new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = ymd(now), month0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const q = (st, extra, ...a) => db.prepare(`SELECT f.*,m.subject,m.from_name,m.id AS mid FROM found_items f JOIN messages m ON m.id=f.message_id WHERE f.user_id=? AND f.kind='deadline' AND f.status=? ${extra}`).all(uid, st, ...a).map((i) => ({ ...i, link: calendarLink(i) }));
  const open = q('new', 'ORDER BY f.starts_at LIMIT 200');
  const paid = q('paid', 'AND f.resolved_at>=? ORDER BY f.resolved_at DESC LIMIT 100', month0);
  const sum = (a) => Math.round(a.reduce((t, i) => t + (i.amount || 0), 0) * 100) / 100;
  const overdue = open.filter((i) => i.starts_at.slice(0, 10) < today);
  return { open, paid, total: sum(open), overdue_total: sum(overdue), overdue: overdue.length, paid_total: sum(paid), unknown: open.filter((i) => !i.amount).length };
});
route('GET', '/api/today', (ctx) => {
  const uid = ctx.user.id, now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const open = db.prepare(`SELECT f.*,m.subject,m.from_name,m.id AS mid FROM found_items f JOIN messages m ON m.id=f.message_id WHERE f.user_id=? AND f.status IN ('new','added') AND f.starts_at>=? ORDER BY f.starts_at LIMIT 100`).all(uid, ymd(d0)).map((i) => ({ ...i, link: calendarLink(i) }));
  const done = db.prepare('SELECT COUNT(*) n FROM found_items WHERE user_id=? AND resolved_at>=?').get(uid, d0.getTime()).n;
  const pending = open.filter((i) => i.status === 'new').length;
  const unread = db.prepare('SELECT COUNT(*) n FROM messages WHERE user_id=? AND unread=1 AND cat=\'inbox\' AND (snoozed_until IS NULL OR snoozed_until<=?)').get(uid, Date.now()).n;
  return { items: open, done, pending, unread, now: now.getTime() };
});

// powiadomienia push (Web Push, iOS 16.4+ po dodaniu do ekranu początkowego)
route('GET', '/api/push/key', () => ({ key: vapidPublicKey() }));
route('POST', '/api/push/subscribe', (ctx) => {
  const s = ctx.body.subscription;
  if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) bad('Niepoprawna subskrypcja');
  db.prepare(`INSERT INTO push_subs(user_id,endpoint,p256dh,auth,ua,created_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,ua=excluded.ua`)
    .run(ctx.user.id, s.endpoint, s.keys.p256dh, s.keys.auth, String(ctx.req.headers['user-agent'] || '').slice(0, 200), Date.now());
  audit(ctx.user.id, 'push_on'); return { ok: true };
});
route('GET', '/api/push/prefs', (ctx) => ({ ...getPrefs(ctx.user.id), devices: db.prepare('SELECT COUNT(*) n FROM push_subs WHERE user_id=?').get(ctx.user.id).n }));
route('POST', '/api/push/prefs', (ctx) => {
  try { setPrefs(ctx.user.id, { mode: ctx.body.mode, quiet: ctx.body.quiet, morning: ctx.body.morning, evening: ctx.body.evening }); } catch (e) { bad(e.message); }
  return getPrefs(ctx.user.id);
});
route('POST', '/api/accounts/:id/notify', (ctx) => {
  const r = db.prepare('UPDATE accounts SET notify=? WHERE id=? AND user_id=?').run(ctx.body.on === false ? 0 : 1, +ctx.params.id, ctx.user.id);
  if (!r.changes) bad('Nie ma takiego konta', 404);
  return { ok: true };
});
route('POST', '/api/push/unsubscribe', (ctx) => { db.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(String(ctx.body.endpoint || ''), ctx.user.id); return { ok: true }; });
route('POST', '/api/push/test', async (ctx) => {
  const n = await sendToUser(ctx.user.id, { title: 'Poczta', body: 'Powiadomienia działają.', url: './#/', tag: 'test' });
  if (!n) bad('Brak aktywnych urządzeń z powiadomieniami');
  return { ok: true, sent: n };
});

// zdarzenia na żywo (SSE)
const sse = new Set();
onEvent((uid, type, data) => { for (const c of sse) if (c.uid === uid) c.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); });
route('GET', '/api/events', (ctx) => {
  ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...HEADERS });
  ctx.res.write('retry: 5000\n\n');
  const c = { uid: ctx.user.id, res: ctx.res }; sse.add(c);
  const hb = setInterval(() => ctx.res.write(': hb\n\n'), 25000);
  ctx.req.on('close', () => { clearInterval(hb); sse.delete(c); });
  ctx.streamed = true;
});

// ---- statyka ----
const staticCache = new Map();
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(config.webDir, rel));
  if (!file.startsWith(config.webDir + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, HEADERS); return res.end('Nie znaleziono'); }
    const ext = path.extname(file);
    const immutable = ext === '.woff2' || (ext === '.png' && rel.startsWith('/icons/'));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : rel === '/sw.js' ? 'no-cache' : 'no-cache', ...HEADERS });
    res.end(buf);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ctx = { req, res, query: url.searchParams, headers: {}, ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), token: cookies(req).sid };
    try {
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/zdrowie') return serveStatic(req, res, url.pathname);
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) return json(res, 404, { error: 'Nie znaleziono' });
      ctx.params = url.pathname.match(r.re).groups || {};
      if (req.method !== 'GET' && req.headers['x-poczta'] !== '1') bad('Brak nagłówka bezpieczeństwa', 403);
      ctx.user = sessionUser(ctx.token);
      if (r.auth && !ctx.user) bad('Zaloguj się', 401);
      ctx.body = req.method === 'GET' ? {} : await readBody(req);
      const out = await r.handler(ctx);
      if (ctx.streamed) return;
      if (ctx.raw) { res.writeHead(200, { 'Content-Type': ctx.raw.type, 'Cache-Control': 'no-store', ...HEADERS, ...ctx.raw.headers }); return res.end(ctx.raw.body); }
      json(res, 200, out ?? { ok: true }, ctx.headers);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.code, { error: e.message }, ctx.headers);
      console.error('Błąd:', e);
      json(res, 500, { error: 'Błąd serwera' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(config.port, config.host, () => console.log(`Poczta działa: http://${config.host}:${config.port}`));
  initialSort();
  startScheduler();
  const stop = () => { server.close(); db.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
