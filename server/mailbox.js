// Porządkowanie poczty: foldery (Skrzynka / Oferty / Spam / Kosz), reguły nadawców, blokowanie, ponowne sortowanie.
import { db, tx, audit } from './db.js';
import { classify, addrDomain, isFreemail } from './intel/classify.js';
import { assessRisk } from './intel/risk.js';
import { extractItems } from './intel/extract.js';

export const CATS = ['inbox', 'offers', 'spam', 'trash', 'blocked', 'sent', 'drafts', 'archive', 'other'];
const ph = (a) => a.map(() => '?').join(',');
const inboxSql = "cat='inbox'";

export const loadRules = (uid) => db.prepare('SELECT id,kind,value,action FROM rules WHERE user_id=?').all(uid);

export function addRule(uid, kind, value, action) {
  value = String(value || '').toLowerCase().trim();
  if (!['sender', 'domain'].includes(kind) || !value || !['spam', 'block', 'offers', 'inbox'].includes(action)) throw new Error('Niepoprawna reguła');
  if (kind === 'domain' && isFreemail(value)) throw new Error('Nie blokujemy całej domeny publicznej poczty. Zablokuj samego nadawcę.');
  db.prepare('INSERT INTO rules(user_id,kind,value,action,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind,value) DO UPDATE SET action=excluded.action')
    .run(uid, kind, value, action, Date.now());
}

// Wiadomości użytkownika pasujące do reguły (nie licząc tych już w koszu/zablokowanych, chyba że blokujemy).
function matching(uid, kind, value) {
  return db.prepare(`SELECT id,cat FROM messages WHERE user_id=? AND folder='INBOX' AND ${kind === 'domain' ? "lower(substr(from_addr, instr(from_addr,'@')+1))=?" : 'lower(from_addr)=?'}`).all(uid, value);
}

export function reextract(id) {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id); if (!m) return 0;
  const ins = db.prepare(`INSERT OR IGNORE INTO found_items(user_id,message_id,kind,title,starts_at,ends_at,all_day,amount,currency,location,confidence,source,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const it of extractItems({ subject: m.subject, body: m.body, fromName: m.from_name, ics: [], received: new Date(m.date) })) {
    n += Number(ins.run(m.user_id, id, it.kind, it.title, it.starts_at, it.ends_at, it.all_day, it.amount ?? null, it.currency ?? null, it.location ?? null, it.confidence, it.source, it.evidence, Date.now()).changes);
  }
  return n;
}

// Przenosi wiadomości do folderu. Poza skrzynką znikają z nich wykryte sprawy, żeby reklamy nie zaśmiecały "Dziś".
export function moveTo(uid, ids, cat, by = 'user') {
  ids = [...new Set(ids.map(Number).filter(Boolean))].slice(0, 1000);
  if (!ids.length || !CATS.includes(cat)) return [];
  const rows = db.prepare(`SELECT id,cat FROM messages WHERE user_id=? AND id IN (${ph(ids)})`).all(uid, ...ids);
  const now = Date.now(), moved = [];
  tx(() => {
    for (const r of rows) {
      if (r.cat === cat) continue;
      const gone = cat === 'trash' || cat === 'blocked' || cat === 'archive', wasGone = r.cat === 'trash' || r.cat === 'blocked' || r.cat === 'archive';
      if (gone && wasGone && !(cat === 'archive' && r.cat !== 'archive') && !(r.cat === 'archive' && cat !== 'archive')) db.prepare('UPDATE messages SET cat=?, cat_by=? WHERE id=?').run(cat, by, r.id);
      else if (gone) db.prepare('UPDATE messages SET cat=?, cat_by=?, trashed_from=?, deleted_at=?, server_done=0, server_try=0, snoozed_until=NULL WHERE id=?').run(cat, by, r.cat, now, r.id);
      else db.prepare('UPDATE messages SET cat=?, cat_by=?, trashed_from=NULL, deleted_at=NULL, snoozed_until=NULL WHERE id=?').run(cat, by, r.id);
      if (cat !== 'inbox') db.prepare("DELETE FROM found_items WHERE message_id=? AND status='new'").run(r.id);
      moved.push(r.id);
    }
  });
  if (cat === 'inbox') for (const id of moved) reextract(id);
  return moved;
}

export function restore(uid, ids) {
  ids = ids.map(Number).filter(Boolean).slice(0, 1000); if (!ids.length) return [];
  const rows = db.prepare(`SELECT id,trashed_from FROM messages WHERE user_id=? AND cat='trash' AND id IN (${ph(ids)})`).all(uid, ...ids);
  const out = [];
  tx(() => { for (const r of rows) { db.prepare("UPDATE messages SET cat=?, cat_by='user', deleted_at=NULL, trashed_from=NULL WHERE id=?").run(r.trashed_from || 'inbox', r.id); out.push(r.id); } });
  for (const r of rows) if (!r.trashed_from || r.trashed_from === 'inbox') reextract(r.id);
  return out;
}

// Reguła + zastosowanie jej do już zapisanych wiadomości tego nadawcy.
export function applyRuleNow(uid, kind, value, action) {
  const cat = { block: 'blocked', spam: 'spam', offers: 'offers', inbox: 'inbox' }[action];
  const rows = matching(uid, kind, value).filter((r) => (action === 'block' ? r.cat !== 'blocked' : !['trash', 'blocked'].includes(r.cat)));
  const ids = rows.map((r) => r.id);
  moveTo(uid, ids, cat, 'user');
  return ids;
}

// gwiazdka: lokalnie od razu, u dostawcy w tle (robi to trasa)
export function star(uid, ids, on) {
  ids = ids.map(Number).filter(Boolean).slice(0, 1000); if (!ids.length) return [];
  const rows = db.prepare(`SELECT id FROM messages WHERE user_id=? AND id IN (${ph(ids)})`).all(uid, ...ids).map((r) => r.id);
  for (const id of rows) db.prepare('UPDATE messages SET starred=? WHERE id=?').run(on ? 1 : 0, id);
  return rows;
}
// cofnięcie spamu/oferty/blokady: usuwa regułę nadawcy (i jego domeny), a wiadomości wracają do skrzynki
export function unrule(uid, ids) {
  ids = ids.map(Number).filter(Boolean).slice(0, 1000); if (!ids.length) return [];
  const rows = db.prepare(`SELECT id,from_addr FROM messages WHERE user_id=? AND folder='INBOX' AND id IN (${ph(ids)})`).all(uid, ...ids);
  const del = db.prepare('DELETE FROM rules WHERE user_id=? AND kind=? AND value=?');
  for (const a of new Set(rows.map((r) => String(r.from_addr || '').toLowerCase()).filter(Boolean))) { del.run(uid, 'sender', a); del.run(uid, 'domain', addrDomain(a)); }
  const done = moveTo(uid, rows.map((r) => r.id), 'inbox', 'user');
  audit(uid, 'unrule', `${done.length}`); return done;
}
export function mark(uid, ids, action, scope = 'sender') {
  ids = ids.map(Number).filter(Boolean).slice(0, 1000);
  if (action === 'delete') return moveTo(uid, ids, 'trash');
  if (action === 'unrule') return unrule(uid, ids);
  if (action === 'archive') { const own = db.prepare(`SELECT id FROM messages WHERE user_id=? AND folder='INBOX' AND cat IN ('inbox','offers','spam') AND id IN (${ph(ids)})`).all(uid, ...ids).map((r) => r.id); return moveTo(uid, own, 'archive'); }
  if (action === 'unarchive') return moveTo(uid, ids, 'inbox');
  if (action === 'restore') return restore(uid, ids);
  if (!['spam', 'offers', 'inbox', 'block'].includes(action)) throw new Error('Nieznana czynność');
  const rows = db.prepare(`SELECT id,from_addr FROM messages WHERE user_id=? AND folder='INBOX' AND id IN (${ph(ids)})`).all(uid, ...ids);
  const done = new Set();
  const senders = [...new Set(rows.map((r) => String(r.from_addr || '').toLowerCase()).filter(Boolean))];
  for (const a of senders) {
    const [kind, value] = scope === 'domain' && !isFreemail(addrDomain(a)) ? ['domain', addrDomain(a)] : ['sender', a];
    addRule(uid, kind, value, action);
    for (const id of applyRuleNow(uid, kind, value, action)) done.add(id);
  }
  // wiadomości bez adresu nadawcy: przenosimy tylko wskazane
  const cat = { block: 'blocked', spam: 'spam', offers: 'offers', inbox: 'inbox' }[action];
  for (const id of moveTo(uid, rows.filter((r) => !r.from_addr).map((r) => r.id), cat)) done.add(id);
  audit(uid, `mark_${action}`, `${done.size}`);
  return [...done];
}

export function emptyFolder(uid, cat) {
  if (!['offers', 'spam'].includes(cat)) throw new Error('Tego folderu nie opróżniamy zbiorczo');
  const ids = db.prepare('SELECT id FROM messages WHERE user_id=? AND cat=?').all(uid, cat).map((r) => r.id);
  moveTo(uid, ids, 'trash'); audit(uid, `empty_${cat}`, `${ids.length}`);
  return ids;
}

// Ostateczne opróżnienie kosza: wiadomości czekające na przeniesienie u dostawcy zostają ukryte jako zablokowane i dokończą drogę.
export function purgeTrash(uid) {
  const r1 = db.prepare("UPDATE messages SET cat='blocked' WHERE user_id=? AND cat='trash' AND server_done=0").run(uid).changes;
  const rows = db.prepare("SELECT id FROM messages WHERE user_id=? AND cat='trash'").all(uid);
  tx(() => { for (const { id } of rows) { db.prepare('DELETE FROM messages_fts WHERE rowid=?').run(id); db.prepare('DELETE FROM messages WHERE id=?').run(id); } });
  audit(uid, 'purge_trash', `${rows.length + r1}`);
  return rows.length + r1;
}

export function reclassifyAll(uid) {
  const rules = loadRules(uid);
  const rows = db.prepare("SELECT id,cat,from_addr,from_name,subject,body FROM messages WHERE user_id=? AND cat IN ('inbox','offers','spam') AND cat_by!='user'").all(uid);
  let changed = 0;
  for (const r of rows) {
    const risk = assessRisk({ fromAddr: r.from_addr, fromName: r.from_name, subject: r.subject, body: r.body || '' });
    const res = classify({ fromAddr: r.from_addr, fromName: r.from_name, subject: r.subject, body: r.body, risk: risk.risk }, rules);
    if (res.cat === r.cat) continue;
    moveTo(uid, [r.id], res.cat, res.by === 'rule' ? 'rule' : 'auto'); changed++;
  }
  // zaostałe "sprawy" z reklam w skrzynce: przeliczamy ostrzejszymi regułami (zachowując dodane i odrzucone)
  const inbox = db.prepare("SELECT id FROM messages WHERE user_id=? AND cat='inbox'").all(uid);
  tx(() => { for (const { id } of inbox) db.prepare("DELETE FROM found_items WHERE message_id=? AND status='new' AND source='rule'").run(id); });
  for (const { id } of inbox) reextract(id);
  return changed;
}

export function counts(uid) {
  const now = Date.now();
  const c = (cat) => db.prepare('SELECT COUNT(*) n, COALESCE(SUM(unread),0) u FROM messages WHERE user_id=? AND cat=?').get(uid, cat);
  return {
    offers: c('offers').n, offers_unread: c('offers').u, spam: c('spam').n, trash: c('trash').n, sent: c('sent').n, drafts: c('drafts').n, archive: c('archive').n,
    starred: db.prepare("SELECT COUNT(*) n FROM messages WHERE user_id=? AND starred=1 AND cat IN ('inbox','offers','sent','archive')").get(uid).n,
    snoozed: db.prepare("SELECT COUNT(*) n FROM messages WHERE user_id=? AND cat='inbox' AND snoozed_until>?").get(uid, now).n,
  };
}

// Jednorazowo po aktualizacji: posortuj istniejącą pocztę każdego użytkownika.
export function initialSort() {
  const done = db.prepare("SELECT 1 FROM flags WHERE user_id=0 AND key='sorted_v1'").get();
  if (done) return;
  for (const { id } of db.prepare('SELECT id FROM users').all()) reclassifyAll(id);
  db.prepare("INSERT INTO flags(user_id,key,value) VALUES(0,'sorted_v1','1') ON CONFLICT(user_id,key) DO UPDATE SET value='1'").run();
}
