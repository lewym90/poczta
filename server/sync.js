// Synchronizacja: konto → wiadomości → sprawy. Jedna synchronizacja naraz (oszczędność RAM na małym VPS).
import { db, tx, audit } from './db.js';
import { decrypt } from './security.js';
import { config } from './config.js';
import { imap } from './providers/imap.js';
import { demo } from './providers/demo.js';
import { extractItems } from './intel/extract.js';
import { assessRisk } from './intel/risk.js';
import { notifyNewMessages } from './push.js';
import { startJobs } from './jobs.js';
import { classify } from './intel/classify.js';
import zlib from 'node:zlib';
import { loadRules } from './mailbox.js';

export const providers = { imap, demo };
const listeners = new Set();
export const onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (userId, type, data = {}) => listeners.forEach((fn) => fn(userId, type, data));

export const accountSecret = (acc) => (acc.secret_enc ? decrypt(acc.secret_enc) : '');
const running = new Set();

// Metadane załączników (i małe obrazki inline z cid) zapisujemy razem z wiadomością; treść dużych załączników pobieramy dopiero na żądanie.
export function saveAtts(messageId, userId, atts) {
  if (!atts) return;
  const ins = db.prepare('INSERT OR REPLACE INTO attachments(user_id,message_id,idx,filename,ctype,size,cid,inline,data) VALUES(?,?,?,?,?,?,?,?,?)');
  for (const a of atts.slice(0, 50)) ins.run(userId, messageId, a.idx, String(a.filename || '').slice(0, 200), String(a.ctype || '').slice(0, 100), a.size || 0, a.cid || null, a.inline ? 1 : 0, a.data || null);
  db.prepare('UPDATE messages SET att_try=1, has_attach=? WHERE id=?').run(atts.some((a) => !a.inline) ? 1 : 0, messageId);
}

export function storeMessages(acc, messages) {
  const insM = db.prepare(`INSERT OR IGNORE INTO messages(user_id,account_id,folder,uid,message_id,from_name,from_addr,to_addr,subject,snippet,body,date,unread,has_attach,risk,risk_reasons,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insF = db.prepare('INSERT INTO messages_fts(rowid,subject,from_text,body) VALUES(?,?,?,?)');
  const insI = db.prepare(`INSERT OR IGNORE INTO found_items(user_id,message_id,kind,title,starts_at,ends_at,all_day,amount,currency,location,confidence,source,evidence,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let added = 0, items = 0; const fresh = [];
  const rules = loadRules(acc.user_id);
  tx(() => {
    for (const m of messages) {
      const risk = assessRisk(m);
      const sorted = classify({ ...m, risk: risk.risk }, rules);
      const blocked = sorted.cat === 'blocked';
      const r = insM.run(acc.user_id, acc.id, 'INBOX', m.uid, m.messageId, m.fromName, m.fromAddr, m.toAddr, m.subject, m.snippet, m.body, m.date, m.unread && !blocked ? 1 : 0, m.hasAttach ? 1 : 0, risk.risk, risk.reasons.length ? JSON.stringify(risk.reasons) : null, Date.now());
      if (!r.changes) continue;
      added++;
      const id = Number(r.lastInsertRowid);
      db.prepare('UPDATE messages SET cat=?, cat_by=?, cat_why=?, deleted_at=? WHERE id=?').run(sorted.cat, sorted.by === 'rule' ? 'rule' : 'auto', sorted.why || null, blocked ? Date.now() : null, id);
      if (m.html && !blocked && m.html.length < 3e6) db.prepare('UPDATE messages SET html_z=?, html_try=1 WHERE id=?').run(zlib.deflateSync(Buffer.from(m.html)), id);
      else if (!m.html) db.prepare('UPDATE messages SET html_try=2 WHERE id=?').run(id); // wiadomość tylko tekstowa: nie ma czego dociągać
      saveAtts(id, acc.user_id, m.atts);
      if (blocked) continue; // zablokowany nadawca: bez śladu w aplikacji, wiadomość trafia do kosza u dostawcy
      insF.run(id, m.subject, `${m.fromName} ${m.fromAddr}`, m.body.slice(0, 60000));
      if (sorted.cat !== 'inbox') continue; // oferty i spam: bez powiadomień i bez wykrywania spraw
      if (m.unread) fresh.push({ id, account_id: acc.id, fromName: m.fromName || m.fromAddr, subject: m.subject, items: [] });
      for (const it of extractItems({ subject: m.subject, body: m.body, fromName: m.fromName, ics: m.ics, received: new Date(m.date) })) {
        const x = insI.run(acc.user_id, id, it.kind, it.title, it.starts_at, it.ends_at, it.all_day, it.amount ?? null, it.currency ?? null, it.location ?? null, it.confidence, it.source, it.evidence, Date.now());
        items += Number(x.changes);
        if (x.changes) fresh.find((f) => f.id === id)?.items.push(it);
      }
    }
  });
  return { added, items, fresh };
}

// Uzupełnianie oryginalnego HTML w tle: każda wiadomość czeka gotowa, zanim ją otworzysz (najpierw najnowsze, partiami po 25).
const filling = new Set();
export async function backfillHtml(accId) {
  if (filling.has(accId)) return 0;
  const acc = db.prepare("SELECT * FROM accounts WHERE id=? AND provider='imap'").get(accId); if (!acc) return 0;
  filling.add(accId); let done = 0;
  try {
    for (let round = 0; round < 12; round++) {
      const rows = db.prepare("SELECT id,uid,user_id,html_z IS NULL AND html_try=0 AS need_html, att_try=0 AND has_attach=1 AS need_att FROM messages WHERE account_id=? AND folder='INBOX' AND cat!='blocked' AND ((html_z IS NULL AND html_try=0) OR (att_try=0 AND has_attach=1)) ORDER BY date DESC LIMIT 25").all(accId);
      if (!rows.length) break;
      let got;
      try { got = await imap.fetchHtmlBatch({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), rows.map((r) => r.uid)); }
      catch { break; } // błąd połączenia: spróbujemy przy następnej okazji
      const byUid = new Map(got.map((g) => [g.uid, g]));
      for (const r of rows) {
        const g = byUid.get(r.uid);
        if (r.need_html) {
          if (g?.html && g.html.length < 3e6) { db.prepare('UPDATE messages SET html_z=?, html_try=1 WHERE id=?').run(zlib.deflateSync(Buffer.from(g.html)), r.id); done++; }
          else db.prepare('UPDATE messages SET html_try=2 WHERE id=? AND html_z IS NULL').run(r.id);
        }
        if (r.need_att) { if (g?.atts) saveAtts(r.id, r.user_id, g.atts); else db.prepare('UPDATE messages SET att_try=1 WHERE id=?').run(r.id); }
      }
    }
  } finally { filling.delete(accId); }
  return done;
}

// Wysłane i Szkice: osobne foldery u dostawcy. Ścieżki wykrywamy raz (folder_state), potem synchronizujemy co najwyżej co 90 s.
export const folderPath = (accId, folder) => (folder === 'INBOX' ? 'INBOX' : db.prepare('SELECT path FROM folder_state WHERE account_id=? AND folder=?').get(accId, folder)?.path || 'INBOX__brak');
const FOLDER_DEF = { SENT: { cat: 'sent', first: 40 }, DRAFTS: { cat: 'drafts', first: 30 } };
function storeFolder(acc, folder, messages) {
  const cat = FOLDER_DEF[folder].cat;
  const ins = db.prepare(`INSERT OR IGNORE INTO messages(user_id,account_id,folder,uid,message_id,from_name,from_addr,to_addr,subject,snippet,body,date,unread,has_attach,cat,cat_by,att_try,html_try,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,'auto',1,?,?)`);
  const insF = db.prepare('INSERT INTO messages_fts(rowid,subject,from_text,body) VALUES(?,?,?,?)');
  let n = 0;
  tx(() => {
    for (const m of messages) {
      const html = m.html && m.html.length < 3e6 ? m.html : '';
      const r = ins.run(acc.user_id, acc.id, folder, m.uid, m.messageId, m.fromName, m.fromAddr, m.toAddr, m.subject, m.snippet, m.body, m.date, m.hasAttach ? 1 : 0, cat, html ? 1 : 2, Date.now());
      if (!r.changes) continue; n++;
      const id = Number(r.lastInsertRowid);
      if (html) db.prepare('UPDATE messages SET html_z=? WHERE id=?').run(zlib.deflateSync(Buffer.from(html)), id);
      saveAtts(id, acc.user_id, m.atts);
      insF.run(id, m.subject, `${m.toAddr} ${m.fromAddr}`, m.body.slice(0, 60000));
    }
  });
  return n;
}
const foldering = new Set();
export async function syncFolders(accId, { force = false } = {}) {
  const acc = db.prepare("SELECT * FROM accounts WHERE id=? AND provider='imap'").get(accId);
  if (!acc || foldering.has(accId)) return 0;
  foldering.add(accId);
  const cfg = { ...JSON.parse(acc.config), email: acc.email }, secret = accountSecret(acc);
  try {
    let st = db.prepare('SELECT * FROM folder_state WHERE account_id=?').all(accId);
    if (!st.length) {
      const sp = await imap.listSpecial(cfg, secret);
      const put = db.prepare('INSERT OR IGNORE INTO folder_state(account_id,folder,path,last_uid) VALUES(?,?,?,0)');
      put.run(accId, 'SENT', sp.sent || ''); put.run(accId, 'DRAFTS', sp.drafts || '');
      st = db.prepare('SELECT * FROM folder_state WHERE account_id=?').all(accId);
    }
    let added = 0;
    for (const f of st) {
      if (!f.path || !FOLDER_DEF[f.folder] || (!force && f.synced_at && Date.now() - f.synced_at < 90e3)) continue;
      try {
        if (f.folder === 'SENT') {
          const res = await imap.sync(cfg, secret, { lastUid: f.last_uid, first: FOLDER_DEF.SENT.first, path: f.path });
          added += storeFolder(acc, 'SENT', res.messages);
          db.prepare('UPDATE folder_state SET last_uid=?, synced_at=? WHERE account_id=? AND folder=?').run(res.lastUid || f.last_uid, Date.now(), accId, 'SENT');
        } else {
          // szkice się zmieniają i znikają: pobieramy ostatnie i uzgadniamy listę lokalną
          const res = await imap.sync(cfg, secret, { lastUid: 0, first: FOLDER_DEF.DRAFTS.first, path: f.path });
          added += storeFolder(acc, 'DRAFTS', res.messages);
          const uids = new Set(res.messages.map((m) => m.uid)), min = res.messages.length >= FOLDER_DEF.DRAFTS.first ? Math.min(...uids) : 0;
          for (const r of db.prepare("SELECT id,uid FROM messages WHERE account_id=? AND folder='DRAFTS' AND cat='drafts'").all(accId)) {
            if (!uids.has(r.uid) && r.uid >= min) { db.prepare('DELETE FROM messages_fts WHERE rowid=?').run(r.id); db.prepare('DELETE FROM messages WHERE id=?').run(r.id); }
          }
          db.prepare('UPDATE folder_state SET synced_at=? WHERE account_id=? AND folder=?').run(Date.now(), accId, 'DRAFTS');
        }
      } catch { /* następna próba przy kolejnej synchronizacji */ }
    }
    if (added) emit(acc.user_id, 'sync', { account: accId, added: 0 });
    return added;
  } catch { return 0; } finally { foldering.delete(accId); }
}

// "Wczytaj starsze": dociąga kolejną porcję wiadomości sprzed najstarszej, którą mamy. Bez powiadomień i bez zmiany kursora synchronizacji.
export async function loadOlder(accId, count = 60) {
  const acc = db.prepare("SELECT * FROM accounts WHERE id=? AND provider='imap'").get(accId);
  if (!acc || running.has(accId)) return { added: 0, left: 0 };
  running.add(accId);
  try {
    const min = db.prepare("SELECT MIN(uid) u FROM messages WHERE account_id=? AND folder='INBOX'").get(accId).u || 0;
    if (!min) return { added: 0, left: 0 };
    const res = await imap.history({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), { beforeUid: min, count });
    const r = storeMessages(acc, res.messages);
    backfillHtml(accId).catch(() => {});
    return { added: r.added, left: res.left };
  } finally { running.delete(accId); }
}

export async function syncAccount(id) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  if (!acc || running.has(id)) return null;
  running.add(id);
  try {
    const prov = providers[acc.provider];
    const cfg = JSON.parse(acc.config);
    const res = await prov.sync({ ...cfg, email: acc.email }, accountSecret(acc), { lastUid: acc.last_uid || 0 });
    const r = storeMessages(acc, res.messages);
    db.prepare("UPDATE accounts SET last_sync=?, last_error=NULL, status='ok', last_uid=? WHERE id=?").run(Date.now(), res.lastUid || acc.last_uid || 0, id);
    if (r.added) {
      emit(acc.user_id, 'sync', { account: id, added: r.added, items: r.items });
      if (acc.last_uid > 0 && r.fresh.length) notifyNewMessages(acc.user_id, r.fresh).catch(() => {}); // pierwsza synchronizacja nie zasypuje powiadomieniami
    }
    backfillHtml(id).catch(() => {});
    syncFolders(id).catch(() => {});
    return { added: r.added, items: r.items };
  } catch (e) {
    const msg = String(e.responseText || e.message || e).slice(0, 300);
    db.prepare("UPDATE accounts SET last_error=?, status='error' WHERE id=?").run(msg, id);
    audit(acc.user_id, 'sync_error', `${acc.email}: ${msg}`);
    emit(acc.user_id, 'sync_error', { account: id });
    return null;
  } finally { running.delete(id); }
}

// IMAP IDLE: serwer poczty sam daje znać o nowej wiadomości, bez odpytywania co chwilę.
const watchers = new Map();
export function watchAccount(id) {
  unwatchAccount(id);
  const w = { stopped: false, stop: null, delay: 5000, timer: null };
  watchers.set(id, w);
  const run = async () => {
    if (w.stopped) return;
    const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
    if (!acc || acc.provider !== 'imap') return;
    try {
      let debounce;
      w.stop = await imap.watch({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), {
        onExists: () => { clearTimeout(debounce); debounce = setTimeout(() => syncAccount(id), 1500); },
        onClose: () => { if (!w.stopped) { w.timer = setTimeout(run, w.delay); w.delay = Math.min(w.delay * 2, 300000); } },
      });
      w.delay = 5000; w.live = true;
    } catch { w.live = false; w.timer = setTimeout(run, w.delay); w.delay = Math.min(w.delay * 2, 300000); }
  };
  run();
}
export function unwatchAccount(id) {
  const w = watchers.get(id); if (!w) return;
  w.stopped = true; clearTimeout(w.timer); try { w.stop?.(); } catch { /* już zamknięte */ } watchers.delete(id);
}
export const watching = (id) => !!watchers.get(id)?.live;

export function startScheduler() {
  db.prepare('UPDATE messages SET html_try=0 WHERE html_z IS NULL AND html_try=1').run(); // przerwane dociąganie z poprzedniego uruchomienia
  for (const { id } of db.prepare("SELECT id FROM accounts WHERE provider='imap'").all()) { watchAccount(id); setTimeout(() => backfillHtml(id).catch(() => {}), 4000); }
  // Zapasowe odpytywanie: rzadziej, gdy IDLE działa.
  const tick = async () => {
    for (const { id } of db.prepare("SELECT id FROM accounts WHERE provider!='demo'").all()) await syncAccount(id);
  };
  const t = setInterval(tick, config.syncEverySec * 1000);
  t.unref();
  const stopJobs = startJobs(emit, {
    trash: async (accId, uids, folder = 'INBOX') => {
      const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(accId);
      if (!acc || acc.provider !== 'imap') return uids.length; // demo: nic do przenoszenia
      return imap.trash({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), uids, folderPath(accId, folder));
    },
  });
  return () => { clearInterval(t); stopJobs(); };
}
