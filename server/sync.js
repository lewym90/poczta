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
import { loadRules } from './mailbox.js';

export const providers = { imap, demo };
const listeners = new Set();
export const onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (userId, type, data = {}) => listeners.forEach((fn) => fn(userId, type, data));

export const accountSecret = (acc) => (acc.secret_enc ? decrypt(acc.secret_enc) : '');
const running = new Set();

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
  for (const { id } of db.prepare("SELECT id FROM accounts WHERE provider='imap'").all()) watchAccount(id);
  // Zapasowe odpytywanie: rzadziej, gdy IDLE działa.
  const tick = async () => {
    for (const { id } of db.prepare("SELECT id FROM accounts WHERE provider!='demo'").all()) await syncAccount(id);
  };
  const t = setInterval(tick, config.syncEverySec * 1000);
  t.unref();
  const stopJobs = startJobs(emit, {
    trash: async (accId, uids) => {
      const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(accId);
      if (!acc || acc.provider !== 'imap') return uids.length; // demo: nic do przenoszenia
      return imap.trash({ ...JSON.parse(acc.config), email: acc.email }, accountSecret(acc), uids);
    },
  });
  return () => { clearInterval(t); stopJobs(); };
}
