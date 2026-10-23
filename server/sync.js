// Synchronizacja: konto → wiadomości → sprawy. Jedna synchronizacja naraz (oszczędność RAM na małym VPS).
import { db, tx, audit } from './db.js';
import { decrypt } from './security.js';
import { config } from './config.js';
import { imap } from './providers/imap.js';
import { demo } from './providers/demo.js';
import { extractItems } from './intel/extract.js';
import { assessRisk } from './intel/risk.js';

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
  let added = 0, items = 0;
  tx(() => {
    for (const m of messages) {
      const risk = assessRisk(m);
      const r = insM.run(acc.user_id, acc.id, 'INBOX', m.uid, m.messageId, m.fromName, m.fromAddr, m.toAddr, m.subject, m.snippet, m.body, m.date, m.unread ? 1 : 0, m.hasAttach ? 1 : 0, risk.risk, risk.reasons.length ? JSON.stringify(risk.reasons) : null, Date.now());
      if (!r.changes) continue;
      added++;
      const id = Number(r.lastInsertRowid);
      insF.run(id, m.subject, `${m.fromName} ${m.fromAddr}`, m.body.slice(0, 60000));
      if (risk.risk >= 2) continue; // z podejrzanych wiadomości nie wyciągamy terminów
      for (const it of extractItems({ subject: m.subject, body: m.body, fromName: m.fromName, ics: m.ics, received: new Date(m.date) })) {
        const x = insI.run(acc.user_id, id, it.kind, it.title, it.starts_at, it.ends_at, it.all_day, it.amount ?? null, it.currency ?? null, it.location ?? null, it.confidence, it.source, it.evidence, Date.now());
        items += Number(x.changes);
      }
    }
  });
  return { added, items };
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
    if (r.added) emit(acc.user_id, 'sync', { account: id, ...r });
    return r;
  } catch (e) {
    const msg = String(e.responseText || e.message || e).slice(0, 300);
    db.prepare("UPDATE accounts SET last_error=?, status='error' WHERE id=?").run(msg, id);
    audit(acc.user_id, 'sync_error', `${acc.email}: ${msg}`);
    emit(acc.user_id, 'sync_error', { account: id });
    return null;
  } finally { running.delete(id); }
}

export function startScheduler() {
  const tick = async () => {
    const ids = db.prepare("SELECT id FROM accounts WHERE provider!='demo'").all().map((r) => r.id);
    for (const id of ids) await syncAccount(id);
  };
  const t = setInterval(tick, config.syncEverySec * 1000);
  t.unref();
  return () => clearInterval(t);
}
