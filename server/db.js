// SQLite (wbudowany node:sqlite, bez natywnych zależności). Każda tabela niesie user_id: gotowe pod wielu użytkowników.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(process.env.POCZTA_DB || path.join(config.dataDir, 'poczta.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');

const MIGRATIONS = [
  `CREATE TABLE users(
     id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
     plan TEXT NOT NULL DEFAULT 'owner', created_at INTEGER NOT NULL);
   CREATE TABLE sessions(
     id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires INTEGER NOT NULL, ua TEXT);
   CREATE TABLE accounts(
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     label TEXT NOT NULL, provider TEXT NOT NULL, email TEXT NOT NULL,
     config TEXT NOT NULL DEFAULT '{}', secret_enc TEXT,
     status TEXT NOT NULL DEFAULT 'new', last_sync INTEGER, last_error TEXT, last_uid INTEGER,
     created_at INTEGER NOT NULL);
   CREATE INDEX accounts_user ON accounts(user_id);
   CREATE TABLE messages(
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     folder TEXT NOT NULL DEFAULT 'INBOX', uid INTEGER NOT NULL, message_id TEXT,
     from_name TEXT, from_addr TEXT, to_addr TEXT, subject TEXT, snippet TEXT, body TEXT,
     date INTEGER NOT NULL, unread INTEGER NOT NULL DEFAULT 1, has_attach INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, UNIQUE(account_id, folder, uid));
   CREATE INDEX messages_user_date ON messages(user_id, date DESC);
   CREATE TABLE found_items(
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT, all_day INTEGER NOT NULL DEFAULT 0,
     amount REAL, currency TEXT, location TEXT, confidence REAL NOT NULL DEFAULT 0.5, source TEXT NOT NULL DEFAULT 'rule',
     evidence TEXT, status TEXT NOT NULL DEFAULT 'new', resolved_at INTEGER, created_at INTEGER NOT NULL,
     UNIQUE(message_id, kind, starts_at));
   CREATE INDEX items_user_status ON found_items(user_id, status, starts_at);
   CREATE VIRTUAL TABLE messages_fts USING fts5(subject, from_text, body, tokenize='unicode61 remove_diacritics 2');
   CREATE TABLE audit(
     id INTEGER PRIMARY KEY, user_id INTEGER, ts INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT);
   CREATE TABLE flags(user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(user_id, key));`,
  `ALTER TABLE messages ADD COLUMN risk INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE messages ADD COLUMN risk_reasons TEXT;`,
  `CREATE TABLE push_subs(
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created_at INTEGER NOT NULL);
   CREATE INDEX push_user ON push_subs(user_id);`,
  `ALTER TABLE accounts ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;`,
  `ALTER TABLE messages ADD COLUMN snoozed_until INTEGER;
   ALTER TABLE messages ADD COLUMN woke_at INTEGER;
   CREATE INDEX msg_snooze ON messages(user_id, snoozed_until);`,
  `ALTER TABLE messages ADD COLUMN cat TEXT NOT NULL DEFAULT 'inbox';
   ALTER TABLE messages ADD COLUMN cat_by TEXT NOT NULL DEFAULT 'auto';
   ALTER TABLE messages ADD COLUMN cat_why TEXT;
   ALTER TABLE messages ADD COLUMN trashed_from TEXT;
   ALTER TABLE messages ADD COLUMN deleted_at INTEGER;
   ALTER TABLE messages ADD COLUMN server_done INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE messages ADD COLUMN server_try INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX msg_cat ON messages(user_id, cat, date DESC);
   CREATE TABLE rules(
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, value TEXT NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL,
     UNIQUE(user_id, kind, value));`,
];

const ver = db.prepare('PRAGMA user_version').get().user_version;
for (let i = ver; i < MIGRATIONS.length; i++) {
  db.exec('BEGIN');
  try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version=${i + 1}`); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const tx = (fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};
export const audit = (userId, action, detail = '') =>
  db.prepare('INSERT INTO audit(user_id,ts,action,detail) VALUES(?,?,?,?)').run(userId ?? null, Date.now(), action, String(detail).slice(0, 500));
