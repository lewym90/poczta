// Zadania cykliczne: powrót odłożonych wiadomości oraz poranny i wieczorny przegląd (push).
import { db } from './db.js';
import { sendToUser, getPrefs, inQuiet } from './push.js';

const TZ = () => process.env.POCZTA_TZ || 'Europe/Warsaw';
const parts = (d = new Date()) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}` };
};
const addDay = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const zl = (n) => `${Number(n).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`;
const plural = (n, a, b, c) => (n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
const hhmm = (s) => (s.includes('T') ? s.slice(11, 16) : '');

export function wakeSnoozed(emit, now = Date.now()) {
  const rows = db.prepare('SELECT id,user_id,from_name,from_addr,subject FROM messages WHERE snoozed_until IS NOT NULL AND snoozed_until<=?').all(now);
  const byUser = new Map();
  for (const r of rows) {
    db.prepare('UPDATE messages SET snoozed_until=NULL, woke_at=?, unread=1 WHERE id=?').run(now, r.id);
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  for (const [uid, list] of byUser) {
    emit?.(uid, 'sync', { added: 0, woke: list.length });
    if (inQuiet(getPrefs(uid).quiet)) continue;
    const one = list.length === 1 ? list[0] : null;
    sendToUser(uid, one
      ? { title: 'Wraca do Ciebie', body: `${one.from_name || one.from_addr}: ${one.subject}`, url: `./#/m/${one.id}`, tag: `wake-${one.id}` }
      : { title: `${list.length} odłożone wiadomości wracają`, body: list.slice(0, 3).map((x) => x.from_name || x.from_addr).join(', '), url: './#/', tag: 'wake' }).catch(() => {});
  }
  return rows.length;
}

export function digestText(uid, kind, today) {
  const open = db.prepare("SELECT kind,title,starts_at,amount FROM found_items WHERE user_id=? AND status='new' ORDER BY starts_at").all(uid);
  const unread = db.prepare('SELECT COUNT(*) n FROM messages WHERE user_id=? AND unread=1 AND cat=\'inbox\' AND (snoozed_until IS NULL OR snoozed_until<=?)').get(uid, Date.now()).n;
  const upTo = (d) => open.filter((i) => i.starts_at.slice(0, 10) <= d);
  const pay = (arr) => arr.filter((i) => i.kind === 'deadline' && i.amount).reduce((t, i) => t + i.amount, 0);
  if (kind === 'morning') {
    const list = upTo(today); if (!list.length && !unread) return null;
    const first = list.find((i) => hhmm(i.starts_at)) || list[0];
    const bits = [];
    if (first) bits.push(`Najbliżej: ${hhmm(first.starts_at) ? hhmm(first.starts_at) + ' ' : ''}${first.title}`);
    const due = pay(upTo(addDay(today, 7))); if (due) bits.push(`do zapłaty w tym tygodniu: ${zl(due)}`);
    if (unread) bits.push(`${unread} ${plural(unread, 'nieprzeczytana', 'nieprzeczytane', 'nieprzeczytanych')}`);
    return { title: list.length ? `Dzień dobry · ${list.length} ${plural(list.length, 'sprawa', 'sprawy', 'spraw')} na dziś` : 'Dzień dobry', body: bits.join(' · '), url: './#/today', tag: 'digest-morning' };
  }
  const tomorrow = addDay(today, 1);
  const left = upTo(today), next = open.filter((i) => i.starts_at.slice(0, 10) === tomorrow);
  if (!left.length && !next.length) return null;
  const bits = [];
  if (next.length) bits.push(`Jutro: ${next.slice(0, 2).map((i) => (hhmm(i.starts_at) ? hhmm(i.starts_at) + ' ' : '') + i.title).join(', ')}`);
  if (left.length) bits.push(`niezałatane z dziś: ${left.length}`);
  return { title: next.length ? `Jutro ${next.length} ${plural(next.length, 'sprawa', 'sprawy', 'spraw')}` : 'Podsumowanie dnia', body: bits.join(' · '), url: './#/today', tag: 'digest-evening' };
}

export function runDigests(now = new Date()) {
  const { date, time } = parts(now);
  const users = db.prepare('SELECT DISTINCT user_id FROM push_subs').all();
  let sent = 0;
  for (const { user_id: uid } of users) {
    const prefs = getPrefs(uid);
    for (const [kind, at] of [['morning', prefs.morning], ['evening', prefs.evening]]) {
      if (!at || time < at) continue;
      const [h, m] = at.split(':').map(Number), [ch, cm] = time.split(':').map(Number);
      if (ch * 60 + cm - (h * 60 + m) > 20) continue; // przegapiony termin (np. restart): nie wysyłamy spóźnionego
      const key = `digest_${kind}_last`;
      if (db.prepare('SELECT value FROM flags WHERE user_id=? AND key=?').get(uid, key)?.value === date) continue;
      db.prepare('INSERT INTO flags(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value').run(uid, key, date);
      const msg = digestText(uid, kind, date);
      if (msg) { sendToUser(uid, msg).catch(() => {}); sent++; }
    }
  }
  return sent;
}

// Usunięte i zablokowane: po krótkiej karencji (na "Cofnij") przenosimy wiadomości do kosza u dostawcy, a po 30 dniach kasujemy lokalne ślady.
const GRACE = 12000, KEEP_DAYS = 30;
export function serverDeleteOn(uid) { return (db.prepare("SELECT value FROM flags WHERE user_id=? AND key='server_delete'").get(uid)?.value ?? '1') === '1'; }
export async function flushTrash(trash, now = Date.now()) {
  const rows = db.prepare("SELECT id,user_id,account_id,uid,folder FROM messages WHERE cat IN ('trash','blocked') AND server_done=0 AND deleted_at<=?").all(now - GRACE);
  const by = new Map();
  for (const r of rows) { const k = `${r.user_id}:${r.account_id}:${r.folder}`; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  let n = 0;
  for (const list of by.values()) {
    if (!serverDeleteOn(list[0].user_id)) { for (const r of list) db.prepare('UPDATE messages SET server_done=2 WHERE id=?').run(r.id); continue; }
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      try { await trash(list[0].account_id, chunk.map((r) => r.uid), list[0].folder); for (const r of chunk) db.prepare('UPDATE messages SET server_done=1 WHERE id=?').run(r.id); n += chunk.length; }
      catch (e) {
        for (const r of chunk) db.prepare('UPDATE messages SET server_try=server_try+1, server_done=CASE WHEN server_try>=2 THEN 2 ELSE 0 END WHERE id=?').run(r.id);
        db.prepare('INSERT INTO audit(user_id,ts,action,detail) VALUES(?,?,?,?)').run(list[0].user_id, Date.now(), 'server_trash_error', String(e.message || e).slice(0, 200));
      }
    }
  }
  return n;
}
// Archiwizacja u dostawcy po tym samym okresie karencji co kosz (można cofnąć w aplikacji).
export async function flushArchive(archive, now = Date.now()) {
  const rows = db.prepare("SELECT id,user_id,account_id,uid FROM messages WHERE cat='archive' AND folder='INBOX' AND server_done=0 AND deleted_at<=?").all(now - GRACE);
  const by = new Map(); for (const r of rows) { if (!by.has(r.account_id)) by.set(r.account_id, []); by.get(r.account_id).push(r); }
  let n = 0;
  for (const [accId, list] of by) {
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      try { await archive(accId, chunk.map((r) => r.uid)); for (const r of chunk) db.prepare('UPDATE messages SET server_done=1 WHERE id=?').run(r.id); n += chunk.length; }
      catch { for (const r of chunk) db.prepare('UPDATE messages SET server_try=server_try+1, server_done=CASE WHEN server_try>=2 THEN 2 ELSE 0 END WHERE id=?').run(r.id); }
    }
  }
  return n;
}
export function purgeOld(now = Date.now()) {
  const old = db.prepare("SELECT id FROM messages WHERE cat IN ('trash','blocked') AND server_done!=0 AND deleted_at<=?").all(now - KEEP_DAYS * 86400e3);
  for (const { id } of old) { db.prepare('DELETE FROM messages_fts WHERE rowid=?').run(id); db.prepare('DELETE FROM messages WHERE id=?').run(id); }
  return old.length;
}

export function startJobs(emit, hooks = {}) {
  let busy = false;
  const t = setInterval(async () => {
    try { wakeSnoozed(emit); runDigests(); } catch { /* następny przebieg */ }
    if (busy || !hooks.trash) return; busy = true;
    try { await flushTrash(hooks.trash); if (hooks.archive) await flushArchive(hooks.archive); purgeOld(); } catch { /* następny przebieg */ } finally { busy = false; }
  }, 30000);
  t.unref();
  return () => clearInterval(t);
}
