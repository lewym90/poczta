// Poczta: serwer API + statyczna aplikacja PWA. Jeden proces, brak zewnętrznych usług.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, tx, audit } from './db.js';
import { encrypt, hashPassword, verifyPassword, createSession, sessionUser, destroySession, rateLimit } from './security.js';
import { openFolder, loadOlder, folderPath, syncFolders, providers, syncAccount, startScheduler, onEvent, accountSecret, watchAccount, unwatchAccount, watching } from './sync.js';
import { moveTo, star, mark, restore, emptyFolder, purgeTrash, reclassifyAll, counts, loadRules, addRule, applyRuleNow, initialSort } from './mailbox.js';
import { serverDeleteOn } from './jobs.js';
import { assertPublicHost } from './security.js';
import zlib from 'node:zlib';
import { cleanHtml, frameDoc } from './intel/mailhtml.js';
import { fetchImage } from './imgproxy.js';
import crypto from 'node:crypto';
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
const MSG_COLS_T0 = "m.id,m.account_id,m.to_addr,m.starred,CASE WHEN m.cat IN ('offers','spam','trash') THEN (SELECT COUNT(*) FROM messages t WHERE t.user_id=m.user_id AND t.cat=m.cat AND m.from_addr!='' AND t.from_addr=m.from_addr) ELSE (SELECT COUNT(*) FROM messages t WHERE t.user_id=m.user_id AND t.account_id=m.account_id AND m.thread_key!='' AND t.thread_key=m.thread_key AND t.cat IN ('inbox','sent','archive')) END AS thread_n,m.from_name,m.from_addr,m.subject,m.snippet,m.date,m.unread,m.has_attach,m.risk,m.snoozed_until,m.woke_at,m.cat,m.cat_why";

// lista z rozmowami zwiniętymi: wiersz jest nieprzeczytany, gdy nieprzeczytana jest dowolna wiadomość rozmowy
const MSG_COLS = MSG_COLS_T0;
const MSG_COLS_T = MSG_COLS_T0.replace('m.unread,', "(m.unread OR EXISTS(SELECT 1 FROM messages u WHERE u.user_id=m.user_id AND u.account_id=m.account_id AND m.thread_key!='' AND u.thread_key=m.thread_key AND u.cat=m.cat AND u.unread=1) OR (m.cat IN ('offers','spam','trash') AND m.from_addr!='' AND EXISTS(SELECT 1 FROM messages u WHERE u.user_id=m.user_id AND u.cat=m.cat AND u.from_addr=m.from_addr AND u.unread=1))) AS unread,");
function expandThreads(uid, ids) {
  const out = new Set(ids.map(Number).filter(Boolean));
  for (const r of db.prepare(`SELECT id,account_id,thread_key,cat,from_addr FROM messages WHERE user_id=? AND id IN (${[...out].map(() => '?').join(',') || 'NULL'})`).all(uid, ...out)) {
    if (['offers', 'spam', 'trash'].includes(r.cat) && r.from_addr) { // Spam, Oferty, Kosz: stos to wszystko od jednego nadawcy
      for (const x of db.prepare('SELECT id FROM messages WHERE user_id=? AND cat=? AND from_addr=? LIMIT 900').all(uid, r.cat, r.from_addr)) out.add(x.id);
      continue;
    }
    if (!r.thread_key) continue;
    for (const x of db.prepare('SELECT id FROM messages WHERE user_id=? AND account_id=? AND thread_key=? AND cat=? LIMIT 100').all(uid, r.account_id, r.thread_key, r.cat)) out.add(x.id);
  }
  return [...out].slice(0, 1000);
}

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

function login(ctx, id, email, plan = 'owner') {
  const token = createSession(id, ctx.req.headers['user-agent']);
  ctx.headers['Set-Cookie'] = sessionCookie(token, 60 * 86400);
  return { user: { id, email, plan } };
}
route('POST', '/api/login', async (ctx) => {
  if (!rateLimit(`login:${ctx.ip}`, 8)) bad('Za dużo prób. Spróbuj za kilka minut.', 429);
  const { email, password } = ctx.body;
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase());
  if (!u || !verifyPassword(String(password || ''), u.pass_hash)) { audit(u?.id, 'login_failed', ctx.ip); bad('Niepoprawny e-mail lub hasło', 401); }
  audit(u.id, 'login', ctx.ip);
  return login(ctx, u.id, u.email, u.plan);
}, { auth: false });
// zaproszenia: właściciel zaprasza osoby; każda ma własne konto, własne skrzynki i własne dane (user_id w każdej tabeli)
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const owner = (ctx) => { if (ctx.user.plan !== 'owner') bad('Tylko właściciel może zapraszać', 403); };
route('GET', '/api/people', (ctx) => {
  owner(ctx);
  const now = Date.now();
  const users = db.prepare("SELECT u.id,u.email,u.plan,u.created_at,(SELECT COUNT(*) FROM accounts a WHERE a.user_id=u.id) AS accounts,(SELECT MAX(ts) FROM audit WHERE user_id=u.id AND action='login') AS last_login FROM users u ORDER BY u.id").all();
  const invites = db.prepare('SELECT id,note,created_at,expires FROM invites WHERE used_by IS NULL AND expires>? ORDER BY id DESC').all(now);
  return { users, invites, guests: users.filter((u) => u.plan !== 'owner').length, maxGuests: config.maxGuests };
});
route('POST', '/api/invites', (ctx) => {
  owner(ctx);
  const now = Date.now();
  const guests = db.prepare("SELECT COUNT(*) n FROM users WHERE plan!='owner'").get().n, open = db.prepare('SELECT COUNT(*) n FROM invites WHERE used_by IS NULL AND expires>?').get(now).n;
  if (guests + open >= config.maxGuests) bad(`Limit osób na tym serwerze: ${config.maxGuests}. Usuń kogoś lub unieważnij zaproszenie.`);
  const code = crypto.randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO invites(user_id,code_hash,note,created_at,expires) VALUES(?,?,?,?,?)').run(ctx.user.id, sha(code), String(ctx.body.note || '').slice(0, 60), now, now + 7 * 86400e3);
  audit(ctx.user.id, 'invite_created'); return { code, expires: now + 7 * 86400e3 };
});
route('DELETE', '/api/invites/:id', (ctx) => { owner(ctx); db.prepare('DELETE FROM invites WHERE id=? AND used_by IS NULL').run(+ctx.params.id); return { ok: true }; });
route('DELETE', '/api/people/:id', (ctx) => {
  owner(ctx);
  const u = db.prepare('SELECT id,email,plan FROM users WHERE id=?').get(+ctx.params.id) || bad('Nie ma takiej osoby', 404);
  if (u.plan === 'owner' || u.id === ctx.user.id) bad('Właściciela nie można usunąć', 400);
  for (const a of db.prepare('SELECT id FROM accounts WHERE user_id=?').all(u.id)) unwatchAccount(a.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  db.exec('DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages)');
  audit(ctx.user.id, 'user_removed', u.email); return { ok: true };
});
route('POST', '/api/join', async (ctx) => {
  if (!rateLimit(`join:${ctx.ip}`, 8)) bad('Za dużo prób. Spróbuj za kilka minut.', 429);
  const { code, email, password } = ctx.body;
  const inv = db.prepare('SELECT * FROM invites WHERE code_hash=? AND used_by IS NULL AND expires>?').get(sha(code || ''), Date.now()) || bad('Zaproszenie jest nieprawidłowe lub wygasło', 403);
  if (!isEmail(email)) bad('Podaj poprawny adres e-mail');
  if (typeof password !== 'string' || password.length < 10) bad('Hasło musi mieć co najmniej 10 znaków');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) bad('Ten adres ma już konto w Poczcie', 409);
  const r = db.prepare("INSERT INTO users(email,pass_hash,plan,created_at) VALUES(?,?,'guest',?)").run(email.toLowerCase(), hashPassword(password), Date.now());
  const id = Number(r.lastInsertRowid);
  db.prepare('UPDATE invites SET used_by=?, used_at=? WHERE id=?').run(id, Date.now(), inv.id);
  audit(id, 'user_joined', email); return login(ctx, id, email.toLowerCase(), 'guest');
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
  if (db.prepare('SELECT COUNT(*) n FROM accounts WHERE user_id=?').get(ctx.user.id).n >= (ctx.user.plan === 'owner' ? 10 : config.guestMaxAccounts)) bad(`Limit kont: ${ctx.user.plan === 'owner' ? 10 : config.guestMaxAccounts}`);
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
  const FOLDERS = { offers: 'offers', spam: 'spam', trash: 'trash', sent: 'sent', drafts: 'drafts', archive: 'archive' };
  if (FOLDERS[tab]) where.push('m.cat=?'), args.push(FOLDERS[tab]);
  else if (tab === 'starred') where.push("m.starred=1 AND m.cat IN ('inbox','offers','sent','archive')");
  else if (tab === 'other') { where.push("m.cat='other' AND m.folder=?"); args.push(String(q.get('folder') || '')); }
  else {
    where.push("m.cat='inbox'");
    if (tab === 'snoozed') { where.push('m.snoozed_until>?'); args.push(now); }
    else { where.push('(m.snoozed_until IS NULL OR m.snoozed_until<=?)'); args.push(now); }
  }
  if (tab === 'unread') where.push('(m.unread=1 OR EXISTS(SELECT 1 FROM messages u WHERE u.user_id=m.user_id AND u.account_id=m.account_id AND m.thread_key!=\'\' AND u.thread_key=m.thread_key AND u.cat=m.cat AND u.unread=1))');
  if (['offers', 'spam', 'trash'].includes(tab)) where.push("(m.from_addr='' OR NOT EXISTS (SELECT 1 FROM messages t WHERE t.user_id=m.user_id AND t.cat=m.cat AND t.from_addr=m.from_addr AND (t.date>m.date OR (t.date=m.date AND t.id>m.id))))");
  else if (!['action', 'dates', 'other', 'snoozed', 'starred'].includes(tab)) where.push(`(m.thread_key IS NULL OR m.thread_key='' OR NOT EXISTS (SELECT 1 FROM messages t WHERE t.user_id=m.user_id AND t.account_id=m.account_id AND t.thread_key=m.thread_key AND t.cat=m.cat AND (t.date>m.date OR (t.date=m.date AND t.id>m.id))${tab === 'unread' ? ' AND t.unread=1' : ''}))`);
  if (tab === 'action') where.push("EXISTS(SELECT 1 FROM found_items f WHERE f.message_id=m.id AND f.status='new')");
  if (tab === 'dates') where.push("EXISTS(SELECT 1 FROM found_items f WHERE f.message_id=m.id AND f.status IN ('new','added'))");
  const rows = db.prepare(`SELECT ${MSG_COLS_T} FROM messages m WHERE ${where.join(' AND ')} ORDER BY MAX(m.date, COALESCE(m.woke_at,0)) DESC LIMIT ?`).all(...args, limit);
  const total = db.prepare("SELECT SUM(unread) u FROM messages WHERE user_id=? AND cat='inbox' AND (snoozed_until IS NULL OR snoozed_until<=?)").get(uid, now);
  const cn = counts(uid);
  return { messages: withItems(uid, rows), unread: total.u || 0, snoozed: cn.snoozed, counts: cn, outbox: db.prepare("SELECT COUNT(*) n FROM outbox WHERE user_id=? AND ((state='queued' AND send_at>?) OR state='failed')").get(uid, now + 15000).n };
});
const imagesOn = (uid) => (db.prepare("SELECT value FROM flags WHERE user_id=? AND key='images'").get(uid)?.value ?? '1') === '1';
// członkowie stosu: rozmowa (skrzynka, wysłane, archiwum) albo wszystko od jednego nadawcy (Spam, Oferty, Kosz), od najnowszej
route('GET', '/api/messages/:id/stack', (ctx) => {
  const uid = ctx.user.id, a = db.prepare('SELECT id,account_id,thread_key,cat,from_addr FROM messages WHERE id=? AND user_id=?').get(+ctx.params.id, uid) || bad('Nie ma takiej wiadomości', 404);
  const limit = Math.min(+ctx.query.get('limit') || 10, 50), before = +ctx.query.get('before') || 0;
  let where, args;
  if (['offers', 'spam', 'trash'].includes(a.cat) && a.from_addr) { where = 'm.user_id=? AND m.cat=? AND m.from_addr=?'; args = [uid, a.cat, a.from_addr]; }
  else if (a.thread_key) { where = "m.user_id=? AND m.account_id=? AND m.thread_key=? AND m.cat IN ('inbox','sent','archive')"; args = [uid, a.account_id, a.thread_key]; }
  else { where = 'm.id=? AND m.user_id=?'; args = [a.id, uid]; }
  if (before) { where += ' AND m.date<?'; args.push(before); }
  const rows = db.prepare(`SELECT ${MSG_COLS} FROM messages m WHERE ${where} ORDER BY m.date DESC, m.id DESC LIMIT ?`).all(...args, limit + 1);
  return { messages: withItems(uid, rows.slice(0, limit)), more: rows.length > limit };
});
route('GET', '/api/messages/:id', async (ctx) => {
  const m = db.prepare('SELECT m.*,a.email AS account_email,a.label AS account_label,a.provider AS account_provider FROM messages m JOIN accounts a ON a.id=m.account_id WHERE m.id=? AND m.user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiej wiadomości', 404);
  const items = db.prepare("SELECT * FROM found_items WHERE message_id=? AND user_id=? AND status!='dismissed' ORDER BY starts_at").all(m.id, ctx.user.id).map((i) => ({ ...i, link: calendarLink(i) }));
  // oryginalny HTML: zapisany przy pobraniu, a dla starszych wiadomości dociągany raz z serwera poczty
  let rawHtml = m.html_z ? zlib.inflateSync(m.html_z).toString('utf8') : '', pending = false;
  if (!rawHtml && m.account_provider === 'imap') {
    if (!m.html_try) { // dociąganie w tle: otwarcie wiadomości nie czeka na serwer poczty
      db.prepare('UPDATE messages SET html_try=1 WHERE id=?').run(m.id);
      const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(m.account_id);
      const job = Promise.race([providers.imap.fetchHtml({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), m.uid, folderPath(m.account_id, m.folder)), new Promise((_, rej) => setTimeout(() => rej(new Error('czas')), 20000))])
        .then((h) => { if (h) db.prepare('UPDATE messages SET html_z=?, html_try=1 WHERE id=?').run(zlib.deflateSync(Buffer.from(h)), m.id); else db.prepare('UPDATE messages SET html_try=2 WHERE id=?').run(m.id); return h || ''; })
        .catch(() => { db.prepare('UPDATE messages SET html_try=2 WHERE id=?').run(m.id); return ''; });
      rawHtml = await Promise.race([job, new Promise((r) => setTimeout(() => r(null), 4000))]) ?? ''; // krótko czekamy, żeby szybkie dociągnięcie było od razu widoczne
      pending = !rawHtml;
    } else if (m.html_try === 1) pending = true;
  }
  const pref = imagesOn(ctx.user.id), images = pref || ctx.query.get('images') === '1';
  const thread = m.thread_key ? db.prepare("SELECT id,from_name,from_addr,to_addr,date,snippet,cat,unread FROM messages WHERE user_id=? AND account_id=? AND thread_key=? AND id!=? AND cat IN ('inbox','sent','archive','offers') ORDER BY date DESC LIMIT 12").all(ctx.user.id, m.account_id, m.thread_key, m.id).reverse().map((t) => ({ ...t, unread: !!t.unread })) : [];
  const atts = db.prepare('SELECT idx,filename,ctype,size,cid,inline,data IS NOT NULL AS has_data FROM attachments WHERE message_id=? ORDER BY idx').all(m.id);
  const cids = new Map(atts.filter((x) => x.inline && x.cid && x.has_data).map((x) => [x.cid, x.idx]));
  const cleaned = rawHtml ? cleanHtml(rawHtml, { images, cid: (c) => (cids.has(c) ? `api/messages/${m.id}/att/${cids.get(c)}?view=1` : null) }) : null;
  return { message: { id: m.id, account_id: m.account_id, account_email: m.account_email, account_label: m.account_label, from_name: m.from_name, from_addr: m.from_addr, to_addr: m.to_addr, subject: m.subject, body: m.body, date: m.date, unread: !!m.unread, risk: m.risk, risk_reasons: m.risk_reasons ? JSON.parse(m.risk_reasons) : [], has_attach: !!m.has_attach, message_id: m.message_id, snoozed_until: m.snoozed_until, cat: m.cat, cat_why: m.cat_why, unsub: m.unsub ? (JSON.parse(m.unsub).one ? 'one' : JSON.parse(m.unsub).mailto ? 'mail' : 'link') : null,
    attachments: atts.filter((x) => !x.inline).map((x) => ({ idx: x.idx, filename: x.filename, ctype: x.ctype, size: x.size })),
    cc_addr: m.cc_addr || '', refs: m.refs || '', message_id: m.message_id, starred: !!m.starred, folder: m.folder,
    thread,
    frame: cleaned ? frameDoc(cleaned.html) : null, html_pending: pending && !cleaned, remote_images: cleaned ? cleaned.remote : 0, images_blocked: !!(cleaned && cleaned.remote && !images) }, items };
});
// starsze wiadomości z serwera poczty (wszystkie skrzynki użytkownika albo jedna)
route('POST', '/api/history', async (ctx) => {
  if (!rateLimit(`hist:${ctx.user.id}`, 20, 60e3)) bad('Chwila, za dużo naraz', 429);
  const only = +ctx.body.account_id || 0;
  const accs = db.prepare("SELECT id FROM accounts WHERE user_id=? AND provider='imap'").all(ctx.user.id).filter((a) => !only || a.id === only);
  let added = 0, left = 0;
  for (const a of accs) { try { const r = await loadOlder(a.id, 60); added += r.added; left += r.left; } catch { /* kolejna skrzynka */ } }
  return { added, left };
});
// pobieranie załącznika; podgląd (view=1) tylko dla obrazów i PDF, reszta zawsze jako pobranie
const VIEWABLE = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf)$/i;
route('GET', '/api/messages/:id/att/:idx', async (ctx) => {
  if (!rateLimit(`att:${ctx.user.id}`, 60, 60e3)) bad('Za dużo pobrań, spróbuj za chwilę', 429);
  const m = db.prepare('SELECT m.id,m.uid,m.folder,m.account_id FROM messages m WHERE m.id=? AND m.user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiej wiadomości', 404);
  const a = db.prepare('SELECT * FROM attachments WHERE message_id=? AND idx=? AND user_id=?').get(m.id, +ctx.params.idx, ctx.user.id) || bad('Nie ma takiego załącznika', 404);
  let buf = a.data, type = a.ctype || 'application/octet-stream';
  if (!buf) {
    const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(m.account_id);
    if (!acc || acc.provider !== 'imap') bad('Załącznik niedostępny', 404);
    const path = m.folder === 'INBOX' ? 'INBOX' : (db.prepare('SELECT path FROM folder_state WHERE account_id=? AND folder=?').get(m.account_id, m.folder)?.path || bad('Folder niedostępny', 404));
    let r; try { r = await providers.imap.fetchAttachment({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), m.uid, a.idx, path); } catch { bad('Nie udało się pobrać załącznika z serwera poczty', 502); }
    if (!r) bad('Załącznik nie istnieje już na serwerze poczty', 404);
    buf = r.content;
  }
  const view = ctx.query.get('view') === '1' && VIEWABLE.test(type);
  const name = (a.filename || 'zalacznik').replace(/[\r\n"\\]/g, '_');
  ctx.raw = { type: view ? type : 'application/octet-stream', body: buf, headers: { 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': view && /pdf/i.test(type) ? "default-src 'none'; style-src 'unsafe-inline'; object-src 'self'" : "default-src 'none'; sandbox", 'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(a.filename || 'zalacznik')}` } };
});
route('GET', '/api/img', async (ctx) => {
  if (!rateLimit(`img:${ctx.user.id}`, 900, 300e3)) bad('Za dużo obrazków naraz', 429);
  const u = ctx.query.get('u') || ''; if (!/^https?:\/\//i.test(u) || u.length > 2000) bad('Zły adres obrazka');
  let r; try { r = await fetchImage(u); } catch (e) { bad('Nie udało się pobrać obrazka', 502); }
  ctx.raw = { type: r.type, body: r.buf, headers: { 'Cache-Control': 'private, max-age=604800', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' } };
});
route('POST', '/api/messages/:id/read', async (ctx) => {
  const m = db.prepare('SELECT m.id,m.uid,m.account_id,m.folder,m.unread,m.cat,m.thread_key FROM messages m WHERE m.id=? AND m.user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiej wiadomości', 404);
  const read = ctx.body.read !== false;
  db.prepare('UPDATE messages SET unread=? WHERE id=?').run(read ? 0 : 1, m.id);
  const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(m.account_id);
  const seen = (r, v) => { if (acc && acc.provider !== 'demo') providers[acc.provider].setSeen({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), r.uid, v, folderPath(r.account_id, r.folder)).catch(() => {}); };
  seen(m, read);
  let count = read && m.unread ? 1 : 0;
  if (read && m.thread_key) { // otwarcie rozmowy oznacza jako przeczytane wszystkie jej wiadomości z tej samej zakładki
    for (const s of db.prepare('SELECT id,uid,account_id,folder FROM messages WHERE user_id=? AND account_id=? AND thread_key=? AND cat=? AND unread=1 AND id!=? LIMIT 30').all(ctx.user.id, m.account_id, m.thread_key, m.cat, m.id)) { db.prepare('UPDATE messages SET unread=0 WHERE id=?').run(s.id); seen(s, true); count++; }
  }
  return { ok: true, count };
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
  let ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : [];
  if (!ids.length || ids.length > 1000) bad('Nie wskazano wiadomości');
  if (ctx.body.thread) ids = expandThreads(ctx.user.id, ids); // gest na zwiniętej rozmowie dotyczy całej rozmowy
  const action = String(ctx.body.action);
  if (action === 'star' || action === 'unstar') {
    const done = star(ctx.user.id, ids, action === 'star');
    for (const r of db.prepare(`SELECT m.uid,m.folder,m.account_id FROM messages m WHERE m.user_id=? AND m.id IN (${done.map(() => '?').join(',') || 'NULL'})`).all(ctx.user.id, ...done)) { // u dostawcy w tle
      const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(r.account_id);
      if (acc?.provider === 'imap') providers.imap.setFlagged({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), r.uid, action === 'star', folderPath(r.account_id, r.folder)).catch(() => {});
    }
    return { ok: true, ids: done, count: done.length };
  }
  let done; try { done = mark(ctx.user.id, ids, action, ctx.body.scope === 'domain' ? 'domain' : 'sender'); } catch (e) { bad(e.message); }
  return { ok: true, ids: done, count: done.length };
});
// ---- kontakty (osobne dla każdej osoby; nic nie jest importowane z telefonu) ----
const normEmail = (e) => String(e || '').trim().toLowerCase();
function readContacts(uid) {
  const cs = db.prepare('SELECT id,name,note,created_at FROM contacts WHERE user_id=? ORDER BY name COLLATE NOCASE LIMIT 5000').all(uid);
  const by = new Map();
  for (const e of db.prepare('SELECT contact_id,email,label FROM contact_emails WHERE user_id=? ORDER BY id').all(uid)) { if (!by.has(e.contact_id)) by.set(e.contact_id, []); by.get(e.contact_id).push({ email: e.email, label: e.label || '' }); }
  return cs.map((c) => ({ ...c, emails: by.get(c.id) || [] }));
}
function saveContact(uid, id, body) {
  const name = String(body.name || '').trim().slice(0, 100);
  const emails = [...new Map((Array.isArray(body.emails) ? body.emails : []).slice(0, 10).map((e) => [normEmail(e.email), { email: normEmail(e.email), label: String(e.label || '').slice(0, 30) }])).values()].filter((e) => e.email);
  if (!emails.length) bad('Podaj co najmniej jeden adres e-mail');
  if (!emails.every((e) => isEmail(e.email))) bad('Niepoprawny adres e-mail');
  const nm = name || emails[0].email.split('@')[0];
  for (const e of emails) {
    const dup = db.prepare('SELECT c.id,c.name FROM contact_emails x JOIN contacts c ON c.id=x.contact_id WHERE x.user_id=? AND x.email=?').get(uid, e.email);
    if (dup && dup.id !== id) bad(`Adres ${e.email} należy już do kontaktu „${dup.name}”`, 409);
  }
  return tx(() => {
    const now = Date.now();
    if (id) { db.prepare('UPDATE contacts SET name=?, note=?, updated_at=? WHERE id=? AND user_id=?').run(nm, String(body.note || '').slice(0, 500), now, id, uid); db.prepare('DELETE FROM contact_emails WHERE contact_id=?').run(id); }
    else id = Number(db.prepare('INSERT INTO contacts(user_id,name,note,created_at,updated_at) VALUES(?,?,?,?,?)').run(uid, nm, String(body.note || '').slice(0, 500), now, now).lastInsertRowid);
    for (const e of emails) db.prepare('INSERT INTO contact_emails(contact_id,user_id,email,label) VALUES(?,?,?,?)').run(id, uid, e.email, e.label || null);
    return id;
  });
}
route('GET', '/api/contacts', (ctx) => ({ contacts: readContacts(ctx.user.id) }));
route('POST', '/api/contacts', (ctx) => {
  if (db.prepare('SELECT COUNT(*) n FROM contacts WHERE user_id=?').get(ctx.user.id).n >= 5000) bad('Limit 5000 kontaktów');
  const id = saveContact(ctx.user.id, 0, ctx.body); audit(ctx.user.id, 'contact_added', ''); return { ok: true, id };
});
route('PUT', '/api/contacts/:id', (ctx) => {
  const id = +ctx.params.id; db.prepare('SELECT id FROM contacts WHERE id=? AND user_id=?').get(id, ctx.user.id) || bad('Nie ma takiego kontaktu', 404);
  saveContact(ctx.user.id, id, ctx.body); return { ok: true, id };
});
route('DELETE', '/api/contacts/:id', (ctx) => {
  const id = +ctx.params.id, uid = ctx.user.id;
  tx(() => { // usunięty kontakt nie wraca do podpowiedzi z korespondencji
    db.prepare('INSERT OR IGNORE INTO contact_hidden(user_id,email) SELECT user_id,email FROM contact_emails WHERE contact_id=? AND user_id=?').run(id, uid);
    db.prepare('DELETE FROM contacts WHERE id=? AND user_id=?').run(id, uid);
  });
  return { ok: true };
});
route('POST', '/api/contacts/hide', (ctx) => { const e = normEmail(ctx.body.email); if (!isEmail(e)) bad('Niepoprawny adres'); db.prepare('INSERT OR IGNORE INTO contact_hidden(user_id,email) VALUES(?,?)').run(ctx.user.id, e); return { ok: true }; });
route('POST', '/api/contacts/unhide', (ctx) => { db.prepare('DELETE FROM contact_hidden WHERE user_id=? AND email=?').run(ctx.user.id, normEmail(ctx.body.email)); return { ok: true }; });
// osoby z korespondencji, których nie ma w kontaktach (podpowiedzi i "Dodaj")
route('GET', '/api/contacts/people', (ctx) => {
  const uid = ctx.user.id, mine = new Set(db.prepare('SELECT lower(email) e FROM accounts WHERE user_id=?').all(uid).map((r) => r.e)), known = new Set([...db.prepare('SELECT email FROM contact_emails WHERE user_id=?').all(uid), ...db.prepare('SELECT email FROM contact_hidden WHERE user_id=?').all(uid)].map((r) => r.email));
  const out = new Map();
  const bump = (a, n, when, w = 1) => { a = normEmail(a); if (!a || mine.has(a) || known.has(a) || !isEmail(a) || /no-?reply|noreply|donotreply|mailer-daemon/i.test(a)) return; const o = out.get(a) || { email: a, name: '', count: 0, last: 0 }; o.count += w; o.last = Math.max(o.last, when); if (n && !o.name) o.name = n; out.set(a, o); };
  for (const r of db.prepare("SELECT from_addr a, MAX(from_name) n, COUNT(*) c, MAX(date) d FROM messages WHERE user_id=? AND cat IN ('inbox','archive') AND from_addr!='' GROUP BY lower(from_addr) ORDER BY c DESC LIMIT 400").all(uid)) bump(r.a, r.n, r.d, r.c);
  for (const r of db.prepare("SELECT to_addr, date FROM messages WHERE user_id=? AND cat='sent' ORDER BY date DESC LIMIT 600").all(uid)) for (const a of String(r.to_addr || '').split(/[,;]\s*/)) bump(a, '', r.date, 3); // do kogo pisałeś liczy się mocniej
  return { people: [...out.values()].sort((x, y) => y.count - x.count || y.last - x.last).slice(0, 300) };
});
// przeglądanie innych folderów dostawcy (etykiety, archiwum itp.)
const folderCache = new Map();
route('GET', '/api/provider-folders', async (ctx) => {
  const acc = db.prepare("SELECT * FROM accounts WHERE id=? AND user_id=? AND provider='imap'").get(+ctx.query.get('account') || 0, ctx.user.id) || bad('Wybierz skrzynkę IMAP', 404);
  const hit = folderCache.get(acc.id);
  if (hit && Date.now() - hit.t < 600e3) return { folders: hit.f };
  let f; try { f = await providers.imap.folders({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc)); } catch { bad('Nie udało się pobrać listy folderów', 502); }
  folderCache.set(acc.id, { t: Date.now(), f }); return { folders: f };
});
route('POST', '/api/provider-folders/open', async (ctx) => {
  if (!rateLimit(`fopen:${ctx.user.id}`, 30, 60e3)) bad('Chwila, za dużo naraz', 429);
  const acc = db.prepare("SELECT id FROM accounts WHERE id=? AND user_id=? AND provider='imap'").get(+ctx.body.account_id || 0, ctx.user.id) || bad('Wybierz skrzynkę IMAP', 404);
  let key; try { key = await openFolder(acc.id, String(ctx.body.path || '')); } catch { bad('Nie udało się otworzyć folderu', 502); }
  if (!key) bad('Niepoprawny folder'); return { folder: key, account_id: acc.id };
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
// operatory: od:/from:, do:/to:, ma:zalacznik (has:attachment), jest:nieprzeczytane (is:unread), jest:gwiazdka (is:starred), w:wyslane|archiwum|wszystko (in:)
const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
function parseSearch(raw) {
  const ops = { from: [], to: [], attach: false, unread: false, starred: false, scope: '' };
  const text = String(raw).replace(/(?:^|\s)([\p{L}]+):(\S+)/gu, (all, k, v) => {
    k = plain(k); v = v.replace(/^"|"$/g, '');
    if (k === 'from' || k === 'od') ops.from.push(v.toLowerCase());
    else if (k === 'to' || k === 'do') ops.to.push(v.toLowerCase());
    else if ((k === 'has' || k === 'ma') && /^(attach|zalacz|plik|file)/.test(plain(v))) ops.attach = true;
    else if ((k === 'is' || k === 'jest') && /^(unread|nieprzecz)/.test(plain(v))) ops.unread = true;
    else if ((k === 'is' || k === 'jest') && /^(star|gwiazd|oznacz)/.test(plain(v))) ops.starred = true;
    else if (k === 'in' || k === 'w') ops.scope = plain(v);
    else return all;
    return ' ';
  });
  return { text, ops };
}
route('GET', '/api/search', (ctx) => {
  const { text, ops } = parseSearch(ctx.query.get('q') || ''), fq = ftsQuery(text);
  const hasOps = ops.from.length || ops.to.length || ops.attach || ops.unread || ops.starred || ops.scope;
  if (!fq && !hasOps) return { messages: [] };
  const cats = { sent: "('sent')", wyslane: "('sent')", inbox: "('inbox')", skrzynka: "('inbox')", archive: "('archive')", archiwum: "('archive')", all: "('inbox','offers','archive','sent','spam','trash')", wszystko: "('inbox','offers','archive','sent','spam','trash')" }[ops.scope] || "('inbox','offers','archive','sent')";
  const where = ['m.user_id=?', `m.cat IN ${cats}`], args = [ctx.user.id];
  const like = (v) => `%${v.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  for (const v of ops.from) { where.push("(lower(m.from_addr) LIKE ? ESCAPE '\\' OR lower(m.from_name) LIKE ? ESCAPE '\\')"); args.push(like(v), like(v)); }
  for (const v of ops.to) { where.push("lower(m.to_addr) LIKE ? ESCAPE '\\'"); args.push(like(v)); }
  if (ops.attach) where.push('m.has_attach=1');
  if (ops.unread) where.push('m.unread=1');
  if (ops.starred) where.push('m.starred=1');
  const rows = fq
    ? db.prepare(`SELECT ${MSG_COLS} FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH ? AND ${where.join(' AND ')} ORDER BY m.date DESC LIMIT 40`).all(fq, ...args)
    : db.prepare(`SELECT ${MSG_COLS} FROM messages m WHERE ${where.join(' AND ')} ORDER BY m.date DESC LIMIT 40`).all(...args);
  return { messages: withItems(ctx.user.id, rows) };
});
// treść załącznika: zapisana lokalnie (małe obrazki inline) albo pobrana z serwera poczty
async function attBuffer(m, a) {
  if (a.data) return Buffer.from(a.data);
  const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(m.account_id);
  if (!acc || acc.provider !== 'imap') return null;
  const r = await providers.imap.fetchAttachment({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), m.uid, a.idx, folderPath(m.account_id, m.folder));
  return r?.content || null;
}
const MAX_ATT_TOTAL = 10 * 1024 * 1024;
const addrList = (v, label) => {
  const l = String(v || '').split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
  if (l.length > 30 || !l.every(isEmail)) bad(`Niepoprawny adres w polu ${label}`);
  return l;
};
// wspólne przygotowanie wiadomości do wysyłki albo zapisu szkicu
async function composeMessage(ctx) {
  const { account_id, to, cc, bcc, subject, text, in_reply_to, references, attachments, forward_of } = ctx.body;
  const acc = db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(+account_id, ctx.user.id) || bad('Wybierz konto nadawcy');
  const msg = { from: acc.email, to: addrList(to, 'Do').join(', '), cc: addrList(cc, 'Dw').join(', '), bcc: addrList(bcc, 'UDW').join(', '), subject: String(subject || '').slice(0, 250), text: String(text || '').slice(0, 200000),
    inReplyTo: String(in_reply_to || '').slice(0, 500) || undefined, references: String(references || '').slice(0, 2000) || undefined, attachments: [] };
  let total = 0;
  for (const a of Array.isArray(attachments) ? attachments.slice(0, 15) : []) {
    const content = Buffer.from(String(a.data || ''), 'base64'); total += content.length;
    if (total > MAX_ATT_TOTAL) bad('Załączniki mogą mieć razem do 10 MB');
    msg.attachments.push({ name: String(a.name || 'plik').replace(/[\r\n"\\/]/g, '_').slice(0, 150), type: /^[\w.+-]+\/[\w.+-]+$/.test(a.type || '') ? a.type : 'application/octet-stream', content });
  }
  if (forward_of) { // przekazanie dalej: dołączamy załączniki oryginału
    const om = db.prepare('SELECT id,uid,folder,account_id FROM messages WHERE id=? AND user_id=?').get(+forward_of, ctx.user.id);
    if (om) for (const a of db.prepare('SELECT * FROM attachments WHERE message_id=? AND inline=0 ORDER BY idx').all(om.id)) {
      if (total + a.size > MAX_ATT_TOTAL) bad('Załączniki oryginału są zbyt duże do przekazania (limit 10 MB)');
      let buf; try { buf = await attBuffer(om, a); } catch { buf = null; }
      if (!buf) bad('Nie udało się pobrać załącznika oryginału do przekazania');
      total += buf.length; msg.attachments.push({ name: a.filename, type: a.ctype, content: buf });
    }
  }
  return { acc, msg };
}
// właściwa wysyłka (natychmiast albo z kolejki)
async function deliver(userId, body) {
  const { acc, msg } = await composeMessage({ user: { id: userId }, body });
  if (!msg.to && !msg.cc && !msg.bcc) bad('Podaj adresata');
  if (!msg.text.trim() && !msg.attachments.length) bad('Wiadomość jest pusta');
  const cfg = JSON.parse(acc.config);
  if (acc.provider !== 'demo' && !cfg.smtp) bad('To konto nie ma skonfigurowanego serwera wysyłki (SMTP)');
  await providers[acc.provider].send({ ...cfg, email: acc.email }, accountSecret(acc), msg);
  audit(userId, 'sent', `${acc.email} -> ${[msg.to, msg.cc, msg.bcc].filter(Boolean).join(',').split(',').length}`);
  if (body.draft_id) { const d = db.prepare("SELECT id FROM messages WHERE id=? AND user_id=? AND cat='drafts'").get(+body.draft_id, userId); if (d) moveTo(userId, [d.id], 'trash'); }
  if (acc.provider === 'imap') setTimeout(() => syncFolders(acc.id, { force: true }).catch(() => {}), 3000); // dostawca zapisuje wysłaną kopię w Wysłanych
  return { acc, msg };
}
// bez delay_ms/at wysyłamy od razu; z nimi wiadomość trafia do kolejki (cofnięcie wysyłki i wysyłka na później)
route('POST', '/api/send', async (ctx) => {
  if (!rateLimit(`send:${ctx.user.id}`, 30, 3600e3)) bad('Limit wysyłki: 30 wiadomości na godzinę', 429);
  const delay = Math.max(0, Math.min(+ctx.body.delay_ms || 0, 600e3)), at = +ctx.body.at || 0;
  if (!delay && !at) { await deliver(ctx.user.id, ctx.body); return { ok: true }; }
  const { acc, msg } = await composeMessage(ctx); // błędy (adresy, rozmiar, brak SMTP) pokazujemy od razu, nie dopiero przy wysyłce
  if (!msg.to && !msg.cc && !msg.bcc) bad('Podaj adresata');
  if (!msg.text.trim() && !msg.attachments.length) bad('Wiadomość jest pusta');
  if (acc.provider !== 'demo' && !JSON.parse(acc.config).smtp) bad('To konto nie ma skonfigurowanego serwera wysyłki (SMTP)');
  const sendAt = at ? Math.max(at, Date.now()) : Date.now() + delay;
  if (sendAt > Date.now() + 366 * 864e5) bad('Wybierz termin w ciągu roku');
  if (db.prepare("SELECT COUNT(*) n FROM outbox WHERE user_id=? AND state IN ('queued','failed')").get(ctx.user.id).n >= 50) bad('Za dużo zaplanowanych wiadomości');
  const r = db.prepare('INSERT INTO outbox(user_id,send_at,payload,subject,to_addr,created_at) VALUES(?,?,?,?,?,?)').run(ctx.user.id, sendAt, JSON.stringify(ctx.body), msg.subject, msg.to || msg.cc || msg.bcc, Date.now());
  return { ok: true, queued: true, id: Number(r.lastInsertRowid), send_at: sendAt };
});
let flushing = false;
export async function flushOutbox(now = Date.now()) {
  if (flushing) return 0; flushing = true; let n = 0;
  try {
    for (const r of db.prepare("SELECT id,user_id,payload,subject FROM outbox WHERE state='queued' AND send_at<=? ORDER BY send_at LIMIT 10").all(now)) {
      if (!db.prepare("UPDATE outbox SET state='sending' WHERE id=? AND state='queued'").run(r.id).changes) continue;
      try { await deliver(r.user_id, JSON.parse(r.payload)); db.prepare('DELETE FROM outbox WHERE id=?').run(r.id); n++; }
      catch (e) {
        db.prepare("UPDATE outbox SET state='failed', error=? WHERE id=?").run(String(e.message || e).slice(0, 300), r.id);
        sendToUser(r.user_id, { title: 'Nie wysłano wiadomości', body: `${r.subject || '(bez tematu)'}: ${String(e.message || e).slice(0, 100)}`, url: './#/', tag: 'outbox-fail' }).catch(() => {});
      }
    }
  } finally { flushing = false; }
  return n;
}
route('GET', '/api/outbox', (ctx) => ({ items: db.prepare("SELECT id,send_at,subject,to_addr,state,error FROM outbox WHERE user_id=? AND state IN ('queued','sending','failed') ORDER BY send_at LIMIT 60").all(ctx.user.id) }));
route('POST', '/api/outbox/:id/cancel', (ctx) => { // anulowanie zwraca treść, żeby można było ją dalej edytować
  const r = db.prepare('SELECT id,state,payload FROM outbox WHERE id=? AND user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Ta wiadomość została już wysłana albo anulowana', 404);
  if (r.state === 'sending') bad('Wiadomość jest właśnie wysyłana', 409);
  db.prepare('DELETE FROM outbox WHERE id=?').run(r.id); return { ok: true, payload: JSON.parse(r.payload) };
});
// wypisanie się z newslettera: jedno kliknięcie (RFC 8058), wiadomość mailto albo otwarcie strony
route('POST', '/api/messages/:id/unsubscribe', async (ctx) => {
  const m = db.prepare('SELECT id,unsub,account_id FROM messages WHERE id=? AND user_id=?').get(+ctx.params.id, ctx.user.id) || bad('Nie ma takiej wiadomości', 404);
  const u = m.unsub ? JSON.parse(m.unsub) : bad('Ta wiadomość nie ma opcji wypisania się', 404);
  const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(m.account_id);
  if (acc.provider === 'demo') { audit(ctx.user.id, 'unsubscribed', 'demo'); return { ok: true, how: 'demo' }; }
  if (u.one && u.http) {
    try {
      const url = new URL(u.http); await assertPublicHost(url.hostname);
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (r.status < 400) { audit(ctx.user.id, 'unsubscribed', url.hostname); return { ok: true, how: 'one' }; }
    } catch { /* spróbujemy innej metody */ }
  }
  if (u.mailto) {
    const mt = new URL(u.mailto), to = decodeURIComponent(mt.pathname);
    if (isEmail(to) && providers[acc.provider] && JSON.parse(acc.config).smtp) {
      await providers[acc.provider].send({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), { from: acc.email, to, subject: mt.searchParams.get('subject') || 'unsubscribe', text: mt.searchParams.get('body') || 'unsubscribe', attachments: [] });
      audit(ctx.user.id, 'unsubscribed', to.split('@')[1] || ''); return { ok: true, how: 'mail' };
    }
  }
  if (u.http) return { ok: true, how: 'link', url: u.http };
  bad('Nie udało się wypisać automatycznie', 502);
});
// wysłane wiadomości bez odpowiedzi (3-45 dni), bez maili do samego siebie i do adresów no-reply
route('GET', '/api/followups', (ctx) => {
  const uid = ctx.user.id, now = Date.now(), mine = new Set(db.prepare('SELECT lower(email) e FROM accounts WHERE user_id=?').all(uid).map((r) => r.e));
  const rows = db.prepare(`SELECT m.id,m.account_id,m.to_addr,m.subject,m.date FROM messages m WHERE m.user_id=? AND m.cat='sent' AND m.follow_off=0 AND m.thread_key IS NOT NULL AND m.thread_key!='' AND m.date<? AND m.date>?
    AND NOT EXISTS (SELECT 1 FROM messages t WHERE t.user_id=m.user_id AND t.account_id=m.account_id AND t.thread_key=m.thread_key AND t.cat IN ('inbox','archive') AND t.date>m.date)
    AND NOT EXISTS (SELECT 1 FROM messages t WHERE t.user_id=m.user_id AND t.account_id=m.account_id AND t.thread_key=m.thread_key AND t.cat='sent' AND (t.date>m.date OR (t.date=m.date AND t.id>m.id)))
    ORDER BY m.date DESC LIMIT 40`).all(uid, now - 3 * 864e5, now - 45 * 864e5);
  const ok = (a) => !mine.has(a) && !/no-?reply|noreply|donotreply/i.test(a);
  return { items: rows.filter((r) => (String(r.to_addr).toLowerCase().match(/[^\s,;<>]+@[^\s,;<>]+/g) || []).some(ok)).slice(0, 20) };
});
route('POST', '/api/messages/:id/followup-off', (ctx) => { db.prepare('UPDATE messages SET follow_off=1 WHERE id=? AND user_id=?').run(+ctx.params.id, ctx.user.id); return { ok: true }; });
// lista wszystkich załączników z wyszukiwaniem po nazwie pliku, temacie i adresie
route('GET', '/api/attachments', (ctx) => {
  const q = String(ctx.query.get('q') || '').trim().toLowerCase().slice(0, 80), kind = ctx.query.get('kind') || '', before = +ctx.query.get('before') || 0;
  const where = ["a.user_id=?", 'a.inline=0', "m.cat IN ('inbox','offers','sent','archive')"], args = [ctx.user.id];
  if (q) { const l = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`; where.push("(lower(a.filename) LIKE ? ESCAPE '\\' OR lower(m.subject) LIKE ? ESCAPE '\\' OR lower(m.from_name) LIKE ? ESCAPE '\\' OR lower(m.from_addr) LIKE ? ESCAPE '\\' OR lower(m.to_addr) LIKE ? ESCAPE '\\')"); args.push(l, l, l, l, l); }
  if (kind === 'pdf') where.push("lower(a.ctype) LIKE '%pdf'");
  else if (kind === 'img') where.push("lower(a.ctype) LIKE 'image/%'");
  else if (kind === 'doc') where.push("(lower(a.ctype) LIKE '%word%' OR lower(a.ctype) LIKE '%excel%' OR lower(a.ctype) LIKE '%spreadsheet%' OR lower(a.ctype) LIKE '%powerpoint%' OR lower(a.ctype) LIKE '%presentation%' OR lower(a.ctype) LIKE 'text/%' OR lower(a.ctype) LIKE '%opendocument%' OR lower(a.filename) LIKE '%.docx' OR lower(a.filename) LIKE '%.xlsx' OR lower(a.filename) LIKE '%.csv')");
  if (before) { where.push('m.date<?'); args.push(before); }
  return { items: db.prepare(`SELECT a.idx,a.filename,a.ctype,a.size,m.id AS mid,m.from_name,m.from_addr,m.to_addr,m.cat,m.date,m.subject FROM attachments a JOIN messages m ON m.id=a.message_id WHERE ${where.join(' AND ')} ORDER BY m.date DESC, a.idx LIMIT 60`).all(...args) };
});
route('GET', '/api/saved-searches', (ctx) => ({ items: db.prepare('SELECT id,name,query FROM saved_searches WHERE user_id=? ORDER BY id').all(ctx.user.id) }));
route('POST', '/api/saved-searches', (ctx) => {
  const query = String(ctx.body.query || '').trim().slice(0, 200), name = String(ctx.body.name || query).trim().slice(0, 40);
  if (!query) bad('Wpisz, czego szukasz');
  if (db.prepare('SELECT COUNT(*) n FROM saved_searches WHERE user_id=?').get(ctx.user.id).n >= 20) bad('Limit 20 zapisanych wyszukiwań');
  if (db.prepare('SELECT id FROM saved_searches WHERE user_id=? AND query=?').get(ctx.user.id, query)) bad('To wyszukiwanie jest już zapisane', 409);
  return { ok: true, id: Number(db.prepare('INSERT INTO saved_searches(user_id,name,query,created_at) VALUES(?,?,?,?)').run(ctx.user.id, name, query, Date.now()).lastInsertRowid) };
});
route('DELETE', '/api/saved-searches/:id', (ctx) => { db.prepare('DELETE FROM saved_searches WHERE id=? AND user_id=?').run(+ctx.params.id, ctx.user.id); return { ok: true }; });
// zapis szkicu: u dostawcy (Szkice) albo lokalnie na koncie demo; poprzednia wersja szkicu trafia do kosza
route('POST', '/api/drafts', async (ctx) => {
  if (!rateLimit(`draft:${ctx.user.id}`, 60, 3600e3)) bad('Za dużo zapisów szkiców', 429);
  const { acc, msg } = await composeMessage({ ...ctx, body: { ...ctx.body, to: ctx.body.to || '', cc: ctx.body.cc || '', bcc: ctx.body.bcc || '' } });
  if (!msg.text.trim() && !msg.subject.trim() && !msg.to && !msg.attachments.length) bad('Szkic jest pusty');
  if (acc.provider === 'imap') {
    let path = folderPath(acc.id, 'DRAFTS');
    if (path === 'INBOX__brak') { await syncFolders(acc.id, { force: true }); path = folderPath(acc.id, 'DRAFTS'); }
    if (!path || path === 'INBOX__brak') bad('Nie znaleziono folderu Szkice u dostawcy');
    await providers.imap.saveDraft({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), msg, path);
  } else {
    const uidn = Math.min(-1, (db.prepare("SELECT MIN(uid) u FROM messages WHERE account_id=? AND folder='DRAFTS'").get(acc.id).u || 0) - 1);
    const r = db.prepare("INSERT INTO messages(user_id,account_id,folder,uid,from_addr,to_addr,subject,snippet,body,date,unread,cat,created_at,html_try,att_try) VALUES(?,?,'DRAFTS',?,?,?,?,?,?,?,0,'drafts',?,2,1)").run(ctx.user.id, acc.id, uidn, acc.email, msg.to, msg.subject, msg.text.slice(0, 160), msg.text, Date.now(), Date.now());
    db.prepare('INSERT INTO messages_fts(rowid,subject,from_text,body) VALUES(?,?,?,?)').run(Number(r.lastInsertRowid), msg.subject, msg.to, msg.text.slice(0, 60000));
  }
  if (ctx.body.replace_id) { const d = db.prepare("SELECT id FROM messages WHERE id=? AND user_id=? AND cat='drafts'").get(+ctx.body.replace_id, ctx.user.id); if (d) moveTo(ctx.user.id, [d.id], 'trash'); }
  if (acc.provider === 'imap') syncFolders(acc.id, { force: true }).catch(() => {});
  audit(ctx.user.id, 'draft_saved', acc.email); return { ok: true };
});
// ustawienia pisania wiadomości (podpis)
route('GET', '/api/compose', (ctx) => ({ signature: db.prepare("SELECT value FROM flags WHERE user_id=? AND key='signature'").get(ctx.user.id)?.value || '' }));
route('POST', '/api/compose', (ctx) => {
  const sig = String(ctx.body.signature || '').slice(0, 600);
  db.prepare("INSERT INTO flags(user_id,key,value) VALUES(?,'signature',?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run(ctx.user.id, sig);
  return { signature: sig };
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
      ctx.body = req.method === 'GET' ? {} : await readBody(req, /^\/api\/(send|drafts)$/.test(url.pathname) ? 15_500_000 : 1_000_000);
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
  db.prepare("UPDATE outbox SET state='failed', error='Przerwano przez restart serwera. Sprawdź folder Wysłane.' WHERE state='sending'").run();
  setInterval(() => flushOutbox().catch(() => {}), 3000).unref();
  const stop = () => { server.close(); db.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
