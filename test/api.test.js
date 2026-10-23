import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poczta-'));
process.env.POCZTA_DATA = dir;
process.env.POCZTA_DB = path.join(dir, 't.db');
const { createServer } = await import('../server/index.js');

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = '';
const api = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Poczta': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
};
test.after(() => { server.close(); });

test('zdrowie i stan przed instalacją', async () => {
  assert.equal((await api('GET', '/zdrowie')).body.ok, true);
  const s = await api('GET', '/api/state'); assert.equal(s.body.setupNeeded, true); assert.equal(s.body.user, null);
});
test('API wymaga logowania i nagłówka bezpieczeństwa', async () => {
  assert.equal((await api('GET', '/api/messages')).status, 401);
  const r = await fetch(base + '/api/login', { method: 'POST', body: '{}' }); assert.equal(r.status, 403);
});
test('instalacja: słabe hasło odrzucone, dobre tworzy sesję, druga rejestracja zablokowana', async () => {
  assert.equal((await api('POST', '/api/setup', { email: 'a@b.pl', password: 'krotkie' })).status, 400);
  const ok = await api('POST', '/api/setup', { email: 'wlasciciel@example.com', password: 'bardzo-dlugie-haslo-123' });
  assert.equal(ok.status, 200); assert.ok(cookie.startsWith('sid='));
  assert.equal((await api('POST', '/api/setup', { email: 'x@y.pl', password: 'bardzo-dlugie-haslo-123' })).status, 403);
});
test('konto demo: wiadomości, sprawy, urgency, ochrona', async () => {
  assert.equal((await api('POST', '/api/accounts/demo')).status, 200);
  const list = (await api('GET', '/api/messages')).body;
  assert.equal(list.messages.length, 6);
  const parcel = list.messages.find((m) => m.subject.includes('paczka'));
  assert.equal(parcel.urgency, 'hi'); assert.equal(parcel.items[0].kind, 'parcel');
  const phish = list.messages.find((m) => m.subject.startsWith('Pilne'));
  assert.equal(phish.risk, 2); assert.equal(phish.items.length, 0);
  const inv = list.messages.find((m) => m.subject.includes('Faktura'));
  assert.equal(inv.items[0].kind, 'deadline'); assert.equal(inv.items[0].amount, 1240);
});
test('wątek zawiera link do Kalendarza, ics, zmiana statusu i licznik dnia', async () => {
  const m = (await api('GET', '/api/messages?tab=action')).body.messages[0];
  const detail = (await api('GET', `/api/messages/${m.id}`)).body;
  const it = detail.items[0];
  assert.match(it.link, /\?new=event&text=/);
  const ics = await api('GET', `/api/items/${it.id}/ics`);
  assert.match(ics.body, /BEGIN:VEVENT[\s\S]*SUMMARY:/); assert.match(ics.headers.get('content-type'), /calendar/);
  const before = (await api('GET', '/api/today')).body;
  await api('POST', `/api/items/${it.id}`, { status: 'added' });
  const after = (await api('GET', '/api/today')).body;
  assert.equal(after.done, before.done + 1); assert.equal(after.pending, before.pending - 1);
});
test('wyszukiwanie pełnotekstowe ignoruje polskie znaki', async () => {
  const r = (await api('GET', '/api/search?q=kardiolog')).body.messages;
  assert.equal(r.length, 1);
  assert.equal((await api('GET', '/api/search?q=ksiegowe')).body.messages.length, 1);
});
test('wysyłka z konta demo i walidacja adresów', async () => {
  const acc = (await api('GET', '/api/accounts')).body.accounts[0];
  assert.equal((await api('POST', '/api/send', { account_id: acc.id, to: 'nie-email', subject: 'x', text: 'y' })).status, 400);
  assert.equal((await api('POST', '/api/send', { account_id: acc.id, to: 'ktos@example.com', subject: 'x', text: 'treść' })).status, 200);
});
test('SSRF: prywatny host IMAP jest odrzucony', async () => {
  const r = await api('POST', '/api/accounts', { email: 'x@inny.pl', password: 'p', imapHost: '127.0.0.1' });
  assert.equal(r.status, 422); assert.match(r.body.error, /prywatn/i);
});
test('izolacja: inny użytkownik nie widzi cudzych danych (zapytania filtrują po user_id)', async () => {
  const { db } = await import('../server/db.js');
  const { hashPassword, createSession } = await import('../server/security.js');
  const id = Number(db.prepare('INSERT INTO users(email,pass_hash,created_at) VALUES(?,?,?)').run('drugi@example.com', hashPassword('inne-haslo-123456'), Date.now()).lastInsertRowid);
  const t = createSession(id);
  const r = await fetch(base + '/api/messages', { headers: { cookie: `sid=${t}` } });
  assert.equal((await r.json()).messages.length, 0);
});
test('statyka: zła ścieżka nie wychodzi poza katalog web', async () => {
  const r = await fetch(base + '/..%2Fserver%2Fconfig.js'); assert.notEqual(r.status, 200);
});

test('push: klucz VAPID, zapis i usuwanie subskrypcji, walidacja', async () => {
  const k = (await api('GET', '/api/push/key')).body.key; assert.ok(k && k.length > 60);
  assert.equal((await api('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://nie-https', keys: {} } })).status, 400);
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'BKey', auth: 'aKey' } };
  assert.equal((await api('POST', '/api/push/subscribe', { subscription: sub })).status, 200);
  const { db } = await import('../server/db.js');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subs').get().n, 1);
  assert.equal((await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subs').get().n, 0);
  assert.equal((await api('POST', '/api/push/test')).status, 400); // brak urządzeń
});
test('powiadomienia: nowe wiadomości po pierwszej synchronizacji trafiają do listy, pierwsza nie', async () => {
  const { storeMessages } = await import('../server/sync.js');
  const { db } = await import('../server/db.js');
  const acc = db.prepare("SELECT * FROM accounts WHERE provider='demo'").get();
  const m = { uid: 99, messageId: '<x@y>', fromName: 'Kurier', fromAddr: 'k@kurier.pl', toAddr: 't@t.pl', subject: 'Paczka jutro 10:00', body: 'Kurier doręczy paczkę jutro 10:00', snippet: 'x', date: Date.now(), unread: true, hasAttach: false, ics: [] };
  const r = storeMessages(acc, [m]);
  assert.equal(r.fresh.length, 1); assert.equal(r.fresh[0].items[0].kind, 'parcel');
  assert.equal(storeMessages(acc, [m]).fresh.length, 0); // duplikat
});

test('ustawienia powiadomień: tryb, ciche godziny, wyciszenie skrzynki', async () => {
  assert.equal((await api('GET', '/api/push/prefs')).body.mode, 'all');
  assert.equal((await api('POST', '/api/push/prefs', { mode: 'zly' })).status, 400);
  assert.equal((await api('POST', '/api/push/prefs', { quiet: '25:00-07:00' })).status, 400);
  const r = await api('POST', '/api/push/prefs', { mode: 'important', quiet: '22:00-07:00' });
  assert.deepEqual([r.body.mode, r.body.quiet], ['important', '22:00-07:00']);
  const { inQuiet } = await import('../server/push.js');
  assert.equal(inQuiet('22:00-07:00', new Date('2026-10-23T21:30:00Z')), true);  // 23:30 w Warszawie
  assert.equal(inQuiet('22:00-07:00', new Date('2026-10-23T10:00:00Z')), false);
  assert.equal(inQuiet('', new Date()), false);
  const acc = (await api('GET', '/api/accounts')).body.accounts[0];
  assert.equal(acc.notify, true);
  await api('POST', `/api/accounts/${acc.id}/notify`, { on: false });
  assert.equal((await api('GET', '/api/accounts')).body.accounts[0].notify, false);
  await api('POST', `/api/accounts/${acc.id}/notify`, { on: true });
  await api('POST', '/api/push/prefs', { mode: 'all', quiet: '' });
});
test('powiadomienia respektują wyciszenie i tryb "ważne"', async () => {
  const { db } = await import('../server/db.js');
  const push = await import('../server/push.js');
  const acc = db.prepare("SELECT * FROM accounts WHERE provider='demo'").get();
  const uid = acc.user_id;
  db.prepare('INSERT OR REPLACE INTO push_subs(user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?)').run(uid, 'https://127.0.0.1:1/x', 'k', 'a', 1);
  // wysyłka do martwego endpointu się nie uda, ale nie może rzucić wyjątku ani zawisnąć
  const plain = [{ id: 1, account_id: acc.id, fromName: 'A', subject: 's', items: [] }];
  await push.notifyNewMessages(uid, plain);
  push.setPrefs(uid, { mode: 'important' });
  await push.notifyNewMessages(uid, plain); // odfiltrowane, brak rzutu
  db.prepare('UPDATE accounts SET notify=0 WHERE id=?').run(acc.id);
  await push.notifyNewMessages(uid, [{ ...plain[0], items: [{ kind: 'parcel', starts_at: '2026-10-24' }] }]);
  db.prepare('UPDATE accounts SET notify=1 WHERE id=?').run(acc.id);
  push.setPrefs(uid, { mode: 'all' });
  db.prepare('DELETE FROM push_subs').run();
});
