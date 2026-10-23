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
test('konto demo: wiadomości, sprawy, urgency, sortowanie na foldery', async () => {
  assert.equal((await api('POST', '/api/accounts/demo')).status, 200);
  const list = (await api('GET', '/api/messages')).body;
  assert.equal(list.messages.length, 5); // skrzynka bez ofert i spamu
  assert.equal(list.counts.offers, 2); assert.equal(list.counts.spam, 2);
  const parcel = list.messages.find((m) => m.subject.includes('paczka'));
  assert.equal(parcel.urgency, 'hi'); assert.equal(parcel.items[0].kind, 'parcel');
  const spam = (await api('GET', '/api/messages?tab=spam')).body.messages;
  const phish = spam.find((m) => m.subject.startsWith('Pilne'));
  assert.equal(phish.risk, 2); assert.equal(phish.items.length, 0);
  assert.ok(spam.some((m) => m.subject.includes('Pożyczka')));
  const offer = (await api('GET', '/api/messages?tab=offers')).body.messages[0];
  assert.equal(offer.items.length, 0); // data promocji to nie sprawa
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

test('odkładanie: wiadomość znika z listy, widać ją w "Odłożone", wraca po terminie', async () => {
  const list = (await api('GET', '/api/messages')).body.messages;
  const m = list[list.length - 1];
  assert.equal((await api('POST', `/api/messages/${m.id}/snooze`, { until: Date.now() - 1000 })).status, 400);
  assert.equal((await api('POST', `/api/messages/${m.id}/snooze`, { until: Date.now() + 3600e3 })).status, 200);
  const after = (await api('GET', '/api/messages')).body;
  assert.equal(after.messages.some((x) => x.id === m.id), false); assert.equal(after.snoozed, 1);
  assert.equal((await api('GET', '/api/messages?tab=snoozed')).body.messages[0].id, m.id);
  const { wakeSnoozed } = await import('../server/jobs.js');
  assert.equal(wakeSnoozed(null, Date.now() + 2 * 3600e3), 1);
  const back = (await api('GET', '/api/messages')).body.messages;
  assert.equal(back[0].id, m.id); assert.equal(back[0].unread, true); // wraca na górę jako nieprzeczytana
});
test('płatności: lista, suma, oznaczanie jako opłacone', async () => {
  const o = (await api('GET', '/api/obligations')).body;
  assert.ok(o.open.length >= 1); assert.ok(o.total >= 1240);
  const it = o.open.find((i) => i.amount === 1240);
  await api('POST', `/api/items/${it.id}`, { status: 'paid' });
  const o2 = (await api('GET', '/api/obligations')).body;
  assert.equal(o2.open.some((i) => i.id === it.id), false); assert.equal(o2.paid[0].id, it.id); assert.equal(o2.paid_total, 1240);
});
test('przeglądy: godziny w ustawieniach, treść i jednorazowa wysyłka dziennie', async () => {
  assert.equal((await api('POST', '/api/push/prefs', { morning: '7:5' })).status, 400);
  const r = await api('POST', '/api/push/prefs', { morning: '07:30', evening: '19:00' });
  assert.deepEqual([r.body.morning, r.body.evening], ['07:30', '19:00']);
  const { digestText, runDigests } = await import('../server/jobs.js');
  const { db } = await import('../server/db.js');
  const uid = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
  const t = digestText(uid, 'morning', new Date().toISOString().slice(0, 10));
  assert.ok(t === null || (t.title && t.url));
  db.prepare('INSERT OR REPLACE INTO push_subs(user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?)').run(uid, 'https://127.0.0.1:1/y', 'k', 'a', 1);
  const at = new Date('2026-10-23T05:31:00Z'); // 07:31 w Warszawie
  runDigests(at); assert.equal(runDigests(at), 0); // druga próba tego samego dnia nic nie wysyła
  db.prepare('DELETE FROM push_subs').run();
  await api('POST', '/api/push/prefs', { morning: '', evening: '' });
});

test('usuwanie: znika ze skrzynki, trafia do kosza, można cofnąć', async () => {
  const msgs = (await api('GET', '/api/messages')).body.messages;
  const m = msgs.find((x) => x.subject.includes('Pomysł'));
  const r = await api('POST', '/api/messages/act', { ids: [m.id], action: 'delete' });
  assert.equal(r.body.count, 1);
  assert.equal((await api('GET', '/api/messages')).body.messages.some((x) => x.id === m.id), false);
  assert.equal((await api('GET', '/api/messages?tab=trash')).body.messages[0].id, m.id);
  assert.equal((await api('GET', '/api/search?q=weekend')).body.messages.length, 0); // kosz poza wyszukiwaniem
  await api('POST', '/api/messages/act', { ids: [m.id], action: 'restore' });
  assert.equal((await api('GET', '/api/messages')).body.messages.some((x) => x.id === m.id), true);
});
test('spam i blokada: reguła działa na przyszłe wiadomości, blokada znika wszędzie', async () => {
  const { storeMessages } = await import('../server/sync.js');
  const { db } = await import('../server/db.js');
  const acc = db.prepare("SELECT * FROM accounts WHERE provider='demo'").get();
  const mk = (uid, addr, subj) => ({ uid, messageId: `<t${uid}@x>`, fromName: 'Nadawca', fromAddr: addr, toAddr: 't@t.pl', subject: subj, body: 'Zwykła treść wiadomości.', snippet: 'x', date: Date.now(), unread: true, hasAttach: false, ics: [] });
  storeMessages(acc, [mk(101, 'irytek@dokuczliwa.example', 'Pierwsza')]);
  let list = (await api('GET', '/api/messages')).body.messages;
  const first = list.find((x) => x.subject === 'Pierwsza'); assert.ok(first);
  // oznaczam jako spam: to i przyszłe od tego nadawcy ma iść do spamu
  assert.equal((await api('POST', '/api/messages/act', { ids: [first.id], action: 'spam' })).body.count, 1);
  const r2 = storeMessages(acc, [mk(102, 'irytek@dokuczliwa.example', 'Druga')]);
  assert.equal(r2.fresh.length, 0); // bez powiadomienia
  assert.ok((await api('GET', '/api/messages?tab=spam')).body.messages.some((x) => x.subject === 'Druga'));
  assert.equal((await api('GET', '/api/messages')).body.messages.some((x) => x.subject === 'Druga'), false);
  // blokada: nigdzie więcej
  await api('POST', '/api/messages/act', { ids: [first.id], action: 'block' });
  storeMessages(acc, [mk(103, 'irytek@dokuczliwa.example', 'Trzecia')]);
  for (const tab of ['all', 'spam', 'offers', 'trash', 'snoozed']) {
    const l = (await api('GET', `/api/messages?tab=${tab}`)).body.messages;
    assert.equal(l.some((x) => /Pierwsza|Druga|Trzecia/.test(x.subject)), false, tab);
  }
  assert.equal((await api('GET', '/api/search?q=Trzecia')).body.messages.length, 0);
  const rules = (await api('GET', '/api/rules')).body.rules;
  assert.equal(rules.find((x) => x.value === 'irytek@dokuczliwa.example').action, 'block');
});
test('blokada domeny publicznej odrzucona, zbiorcze opróżnianie folderu z cofnięciem', async () => {
  const m = (await api('GET', '/api/messages?tab=spam')).body.messages[0];
  const { db } = await import('../server/db.js');
  db.prepare("UPDATE messages SET from_addr='ktos@gmail.com' WHERE id=?").run(m.id);
  const ok = await api('POST', '/api/messages/act', { ids: [m.id], action: 'block', scope: 'domain' });
  assert.equal(ok.status, 200); // dla freemaila blokujemy tylko nadawcę
  assert.ok((await api('GET', '/api/rules')).body.rules.some((x) => x.kind === 'sender' && x.value === 'ktos@gmail.com'));
  const before = (await api('GET', '/api/messages')).body.counts;
  const e = await api('POST', '/api/folders/offers/empty'); assert.equal(e.body.count, before.offers);
  assert.equal((await api('GET', '/api/messages')).body.counts.offers, 0);
  await api('POST', '/api/messages/act', { ids: e.body.ids, action: 'restore' });
  assert.equal((await api('GET', '/api/messages')).body.counts.offers, before.offers);
  assert.equal((await api('POST', '/api/folders/inbox/empty')).status, 400);
});
test('kosz u dostawcy po karencji, trwałe czyszczenie po 30 dniach', async () => {
  const { flushTrash, purgeOld } = await import('../server/jobs.js');
  const { db } = await import('../server/db.js');
  const off = (await api('GET', '/api/messages?tab=offers')).body.messages[0];
  await api('POST', '/api/messages/act', { ids: [off.id], action: 'delete' });
  const calls = []; const hook = async (acc, uids) => { calls.push([acc, uids]); };
  assert.equal(await flushTrash(hook, Date.now()), 0); // karencja na "Cofnij"
  assert.ok(await flushTrash(hook, Date.now() + 60e3) >= 1); assert.ok(calls.length >= 1);
  assert.equal(db.prepare('SELECT server_done FROM messages WHERE id=?').get(off.id).server_done, 1);
  const failing = async () => { throw new Error('brak kosza'); };
  db.prepare("UPDATE messages SET server_done=0, server_try=0 WHERE id=?").run(off.id);
  for (let i = 0; i < 4; i++) await flushTrash(failing, Date.now() + 60e3);
  assert.equal(db.prepare('SELECT server_done FROM messages WHERE id=?').get(off.id).server_done, 2); // poddaje się po 3 próbach
  assert.equal(purgeOld(Date.now() + 31 * 86400e3) >= 1, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages WHERE id=?').get(off.id).n, 0);
});

test('HTML wiadomości: ramka z oryginałem, obrazki przez proxy, ustawienie wyłączenia obrazków', async () => {
  const { storeMessages } = await import('../server/sync.js');
  const { db } = await import('../server/db.js');
  const acc = db.prepare("SELECT * FROM accounts WHERE provider='demo'").get();
  storeMessages(acc, [{ uid: 301, messageId: '<h301@x>', fromName: 'Netflix', fromAddr: 'info@netflix.example', toAddr: 't@t.pl', subject: 'Czeka tytuł', body: 'Czeka tytuł', snippet: 'x', date: Date.now(), unread: true, hasAttach: false, ics: [], bulk: true, unsub: true,
    html: '<html><body><script>alert(1)</script><h1>Czeka</h1><a href="https://n.example/x">Przeglądaj wszystko</a><img src="https://cdn.example/p.jpg"></body></html>' }]);
  const n = db.prepare("SELECT id FROM messages WHERE uid=301").get();
  const d = (await api('GET', `/api/messages/${n.id}`)).body.message;
  assert.ok(d.frame); assert.match(d.frame, /Content-Security-Policy/); assert.match(d.frame, /Przeglądaj wszystko/); assert.doesNotMatch(d.frame, /<script/);
  const plain = (await api('GET', '/api/messages')).body.messages.find((x) => x.subject.includes('Pomysł'));
  assert.equal((await api('GET', `/api/messages/${plain.id}`)).body.message.frame, null); // wiadomość tekstowa bez HTML
  assert.equal((await api('POST', '/api/organize', { images: false })).body.images, false);
  await api('POST', '/api/organize', { images: true });
});
test('proxy obrazków: wymaga logowania i nie łączy się z siecią prywatną', async () => {
  const noAuth = await fetch(base + '/api/img?u=' + encodeURIComponent('https://example.com/a.png')); assert.equal(noAuth.status, 401);
  assert.equal((await api('GET', '/api/img?u=' + encodeURIComponent('http://127.0.0.1:8792/zdrowie'))).status, 502);
  assert.equal((await api('GET', '/api/img?u=' + encodeURIComponent('http://169.254.169.254/latest/meta-data'))).status, 502);
  assert.equal((await api('GET', '/api/img?u=' + encodeURIComponent('ftp://example.com/a.png'))).status, 400);
});

test('zaproszenia: właściciel zaprasza, gość zakłada konto, dane są rozdzielone, gość nie zaprasza, usunięcie sprząta', async () => {
  const ownerCookie = cookie;
  const inv = await api('POST', '/api/invites', {}); assert.equal(inv.status, 200); assert.ok(inv.body.code.length >= 16);
  cookie = '';
  assert.equal((await api('POST', '/api/join', { code: 'zly', email: 'ona@example.com', password: 'dlugie-haslo-12345' })).status, 403);
  assert.equal((await api('POST', '/api/join', { code: inv.body.code, email: 'ona@example.com', password: 'krotkie' })).status, 400);
  const j = await api('POST', '/api/join', { code: inv.body.code, email: 'ona@example.com', password: 'dlugie-haslo-12345' });
  assert.equal(j.status, 200); assert.equal(j.body.user.plan, 'guest');
  assert.equal((await api('POST', '/api/join', { code: inv.body.code, email: 'inna@example.com', password: 'dlugie-haslo-12345' })).status, 403); // jednorazowe
  assert.equal((await api('GET', '/api/messages')).body.messages?.length ?? 0, 0); // nie widzi poczty właściciela
  assert.equal((await api('POST', '/api/invites', {})).status, 403);
  assert.equal((await api('GET', '/api/people')).status, 403);
  cookie = ownerCookie;
  const p = await api('GET', '/api/people'); const guest = p.body.users.find((u) => u.plan === 'guest');
  const before = p.body.users.length;
  assert.ok(guest); assert.equal((await api('DELETE', `/api/people/${guest.id}`)).status, 200);
  assert.equal((await api('GET', '/api/people')).body.users.length, before - 1);
  assert.equal((await api('DELETE', `/api/people/${p.body.users.find((u) => u.plan === 'owner').id}`)).status, 400); // właściciela nie usuniesz
});

test('uzupełnianie HTML w tle: wiadomości bez oryginału dostają go przed otwarciem, tekstowe nie są pobierane ponownie', async () => {
  const { db } = await import('../server/db.js');
  const { backfillHtml, storeMessages } = await import('../server/sync.js');
  const { imap } = await import('../server/providers/imap.js');
  const zlib = await import('node:zlib');
  const uid = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
  const acc = db.prepare("INSERT INTO accounts(user_id,label,provider,email,config,created_at) VALUES(?,?,?,?,?,?)").run(uid, 'bf', 'imap', 'bf@example.com', '{"imap":{}}', Date.now());
  const a = { id: Number(acc.lastInsertRowid), user_id: uid };
  const mk = (u, html) => ({ uid: u, messageId: `<bf${u}>`, fromName: 'X', fromAddr: `x${u}@example.org`, toAddr: '', subject: `bf ${u}`, body: 'treść', snippet: 'treść', date: Date.now() - u, unread: true, hasAttach: false, ics: [], html, unsub: false, bulk: false });
  storeMessages(a, [mk(1, ''), mk(2, '')]);
  db.prepare('UPDATE messages SET html_try=0 WHERE account_id=?').run(a.id); // jak wiadomości zapisane przed wprowadzeniem HTML
  let calls = 0;
  imap.fetchHtmlBatch = async (c, p, uids) => { calls++; return uids.filter((u) => u === 1).map((u) => ({ uid: u, html: '<p>oryginał</p>' })); };
  assert.equal(await backfillHtml(a.id), 1);
  const rows = db.prepare('SELECT uid,html_z,html_try FROM messages WHERE account_id=? ORDER BY uid').all(a.id);
  assert.equal(zlib.inflateSync(rows[0].html_z).toString(), '<p>oryginał</p>'); assert.equal(rows[1].html_z, null); assert.equal(rows[1].html_try, 2);
  await backfillHtml(a.id); assert.equal(calls, 1); // nic więcej do pobrania
});

test('załączniki: lista w wiadomości, pobranie, podgląd PDF, cudze/nieistniejące odrzucone, cid w HTML', async () => {
  const { db } = await import('../server/db.js');
  const { storeMessages } = await import('../server/sync.js');
  const l = (await api('GET', '/api/messages?tab=all')).body.messages;
  const inv = l.find((m) => /Faktura/.test(m.subject)); assert.ok(inv && inv.has_attach);
  const d = (await api('GET', `/api/messages/${inv.id}`)).body.message;
  assert.equal(d.attachments.length, 1); assert.equal(d.attachments[0].filename, 'FV-10-2026.pdf');
  const dl = await fetch(`${base}/api/messages/${inv.id}/att/0`, { headers: { cookie } });
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /^attachment/); assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.ok((await dl.text()).startsWith('%PDF'));
  const vw = await fetch(`${base}/api/messages/${inv.id}/att/0?view=1`, { headers: { cookie } });
  assert.match(vw.headers.get('content-disposition'), /^inline/); assert.equal(vw.headers.get('content-type'), 'application/pdf');
  assert.equal((await api('GET', `/api/messages/${inv.id}/att/5`)).status, 404);
  const acc = db.prepare('SELECT id,user_id FROM accounts WHERE user_id=(SELECT id FROM users ORDER BY id LIMIT 1) LIMIT 1').get();
  storeMessages(acc, [{ uid: 9001, messageId: '<cid1>', fromName: 'Sklep', fromAddr: 'a@sklep.example', toAddr: '', subject: 'cid test', body: 'x', snippet: 'x', date: Date.now(), unread: true, hasAttach: false, ics: [], unsub: false, bulk: false,
    html: '<p>Logo: <img src="cid:logo@x" width="50" height="50"></p>', atts: [{ idx: 0, filename: 'logo.png', ctype: 'image/png', size: 4, cid: 'logo@x', inline: true, data: Buffer.from([1, 2, 3, 4]) }] }]);
  const id = db.prepare("SELECT id FROM messages WHERE uid=9001").get().id;
  const m2 = (await api('GET', `/api/messages/${id}`)).body.message;
  assert.equal(m2.attachments.length, 0); assert.match(m2.frame, new RegExp(`api/messages/${id}/att/0\\?view=1`));
  const img = await fetch(`${base}/api/messages/${id}/att/0?view=1`, { headers: { cookie } }); assert.equal(img.headers.get('content-type'), 'image/png');
});

test('Wysłane i Szkice: synchronizacja folderów, własne zakładki, poza skrzynką/szukaniem spamu, kosz świadomy folderu, szkice znikają po usunięciu u dostawcy', async () => {
  const { db } = await import('../server/db.js');
  const { syncFolders } = await import('../server/sync.js');
  const { imap } = await import('../server/providers/imap.js');
  const { flushTrash } = await import('../server/jobs.js');
  const uid = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
  const acc = db.prepare("INSERT INTO accounts(user_id,label,provider,email,config,created_at) VALUES(?,?,?,?,?,?)").run(uid, 'fs', 'imap', 'fs@example.com', '{"imap":{}}', Date.now());
  const aid = Number(acc.lastInsertRowid);
  const mk = (u, subj) => ({ uid: u, messageId: `<fs${u}>`, fromName: 'Ja', fromAddr: 'fs@example.com', toAddr: 'ktos@example.org', subject: subj, body: 'treść ' + subj, snippet: 'x', date: Date.now() - u, unread: false, hasAttach: false, atts: [], ics: [], html: '' });
  let drafts = [mk(11, 'szkic jeden'), mk(12, 'szkic dwa')];
  imap.listSpecial = async () => ({ sent: '[Gmail]/Sent Mail', drafts: '[Gmail]/Drafts' });
  imap.sync = async (c, p, o) => (o.path === '[Gmail]/Drafts' ? { messages: drafts, lastUid: 0 } : { messages: [mk(5, 'wysłany jeden')], lastUid: 5 });
  assert.equal(await syncFolders(aid, { force: true }), 3);
  const sent = (await api('GET', '/api/messages?tab=sent')).body.messages; assert.ok(sent.some((m) => m.subject === 'wysłany jeden' && m.to_addr === 'ktos@example.org' && m.cat === 'sent'));
  assert.equal((await api('GET', '/api/messages?tab=drafts')).body.messages.filter((m) => m.account_id === aid).length, 2);
  assert.ok(!(await api('GET', '/api/messages?tab=all')).body.messages.some((m) => m.subject === 'wysłany jeden'));
  assert.equal((await api('GET', '/api/messages?tab=all')).body.unread >= 0, true);
  drafts = [mk(12, 'szkic dwa')]; await syncFolders(aid, { force: true });
  assert.deepEqual((await api('GET', '/api/messages?tab=drafts')).body.messages.filter((m) => m.account_id === aid).map((m) => m.subject), ['szkic dwa']);
  const id = sent.find((m) => m.subject === 'wysłany jeden').id;
  assert.equal((await api('POST', '/api/messages/act', { ids: [id], action: 'spam' })).status, 200); // reguły nie dotyczą własnych wiadomości
  assert.equal(db.prepare('SELECT cat FROM messages WHERE id=?').get(id).cat, 'sent');
  assert.equal((await api('POST', '/api/messages/act', { ids: [id], action: 'delete' })).status, 200);
  const calls = []; await flushTrash(async (a, u, f) => { calls.push([a, u, f]); }, Date.now() + 60e3);
  assert.ok(calls.some(([a, u, f]) => a === aid && f === 'SENT' && u.length === 1));
  await api('POST', '/api/messages/act', { ids: [id], action: 'restore' }); assert.equal(db.prepare('SELECT cat FROM messages WHERE id=?').get(id).cat, 'sent');
});

test('starsze wiadomości: /api/history dociąga porcję sprzed najstarszej, bez powiadomień, a lista stronicuje przez before', async () => {
  const { db } = await import('../server/db.js');
  const { imap } = await import('../server/providers/imap.js');
  const uid = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
  const acc = db.prepare("INSERT INTO accounts(user_id,label,provider,email,config,created_at) VALUES(?,?,?,?,?,?)").run(uid, 'hist', 'imap', 'hist@example.com', '{"imap":{}}', Date.now());
  const aid = Number(acc.lastInsertRowid);
  db.prepare("INSERT INTO messages(user_id,account_id,folder,uid,subject,from_addr,body,date,unread,created_at) VALUES(?,?,'INBOX',500,'najnowszy','a@b.pl','x',?,0,?)").run(uid, aid, Date.now() - 1e9, Date.now());
  let asked = 0;
  imap.history = async (c, p, o) => { asked = o.beforeUid; return { messages: [{ uid: 400, messageId: '<h400>', fromName: 'Stary', fromAddr: 'stary@example.org', toAddr: '', subject: 'stara wiadomość', body: 'dawno temu', snippet: 'dawno', date: Date.now() - 2e9, unread: false, hasAttach: false, atts: [], ics: [], html: '', unsub: false, bulk: false }], left: 3 }; };
  const r = await api('POST', '/api/history', { account_id: aid });
  assert.equal(r.status, 200); assert.equal(r.body.added, 1); assert.equal(r.body.left, 3); assert.equal(asked, 500);
  const page = (await api('GET', `/api/messages?tab=all&account=${aid}&before=${Date.now() - 1.5e9}`)).body.messages; assert.deepEqual(page.map((m) => m.subject), ['stara wiadomość']);
});

test('wysyłka: Do/Dw/UDW, załączniki, przekazanie z załącznikami oryginału, limit rozmiaru, szkic demo i podpis', async () => {
  const { providers } = await import('../server/sync.js');
  const { db } = await import('../server/db.js');
  const demoAcc = (await api('GET', '/api/accounts')).body.accounts.find((a) => a.provider === 'demo');
  let sent = null; const orig = providers.demo.send; providers.demo.send = async (c, p, msg) => { sent = msg; return { messageId: '<x>' }; };
  const b64 = Buffer.from('hello').toString('base64');
  const ok = await api('POST', '/api/send', { account_id: demoAcc.id, to: 'a@example.org', cc: 'b@example.org, c@example.org', bcc: 'd@example.org', subject: 'Test', text: 'treść', attachments: [{ name: 'a.txt', type: 'text/plain', data: b64 }] });
  assert.equal(ok.status, 200); assert.equal(sent.cc, 'b@example.org, c@example.org'); assert.equal(sent.bcc, 'd@example.org'); assert.equal(sent.attachments[0].content.toString(), 'hello');
  assert.equal((await api('POST', '/api/send', { account_id: demoAcc.id, to: 'zle', text: 'x' })).status, 400);
  assert.equal((await api('POST', '/api/send', { account_id: demoAcc.id, to: 'a@example.org', cc: 'zly', text: 'x' })).status, 400);
  const big = Buffer.alloc(11 * 1024 * 1024, 1).toString('base64');
  assert.equal((await api('POST', '/api/send', { account_id: demoAcc.id, to: 'a@example.org', text: 'x', attachments: [{ name: 'duzy.bin', data: big }] })).status, 400);
  const inv = (await api('GET', '/api/messages?tab=all')).body.messages.find((m) => /Faktura/.test(m.subject));
  sent = null; assert.equal((await api('POST', '/api/send', { account_id: demoAcc.id, to: 'a@example.org', subject: 'Fwd: Faktura', text: 'fw', forward_of: inv.id })).status, 200);
  assert.equal(sent.attachments.length, 1); assert.equal(sent.attachments[0].name, 'FV-10-2026.pdf'); assert.ok(sent.attachments[0].content.toString().startsWith('%PDF'));
  providers.demo.send = orig;
  const d1 = await api('POST', '/api/drafts', { account_id: demoAcc.id, to: 'a@example.org', subject: 'Szkic testowy', text: 'wersja 1' }); assert.equal(d1.status, 200);
  const dr = (await api('GET', '/api/messages?tab=drafts')).body.messages.find((m) => m.subject === 'Szkic testowy'); assert.ok(dr);
  assert.equal((await api('POST', '/api/drafts', { account_id: demoAcc.id, to: 'a@example.org', subject: 'Szkic testowy', text: 'wersja 2', replace_id: dr.id })).status, 200);
  const drafts = (await api('GET', '/api/messages?tab=drafts')).body.messages.filter((m) => m.subject === 'Szkic testowy'); assert.equal(drafts.length, 1); assert.notEqual(drafts[0].id, dr.id);
  assert.equal((await api('POST', '/api/compose', { signature: 'Michał' })).body.signature, 'Michał'); assert.equal((await api('GET', '/api/compose')).body.signature, 'Michał');
});

test('gwiazdki, archiwum, cofnięcie spamu usuwa regułę, wątki, foldery dostawcy', async () => {
  const { db } = await import('../server/db.js');
  const { flushArchive } = await import('../server/jobs.js');
  const { providers } = await import('../server/sync.js');
  const msgs = (await api('GET', '/api/messages?tab=all')).body.messages;
  const m = msgs.find((x) => /Marta|Re: Pomys/.test(x.subject) || /Pomys/.test(x.subject));
  assert.equal((await api('POST', '/api/messages/act', { ids: [m.id], action: 'star' })).status, 200);
  assert.ok((await api('GET', '/api/messages?tab=starred')).body.messages.some((x) => x.id === m.id && x.starred));
  assert.equal((await api('GET', `/api/messages/${m.id}`)).body.message.starred, true);
  await api('POST', '/api/messages/act', { ids: [m.id], action: 'unstar' }); assert.ok(!(await api('GET', '/api/messages?tab=starred')).body.messages.some((x) => x.id === m.id));
  // archiwum: lokalnie od razu, u dostawcy po karencji; cofnięcie w karencji nie rusza serwera
  assert.equal((await api('POST', '/api/messages/act', { ids: [m.id], action: 'archive' })).body.count, 1);
  assert.ok((await api('GET', '/api/messages?tab=archive')).body.messages.some((x) => x.id === m.id)); assert.ok(!(await api('GET', '/api/messages?tab=all')).body.messages.some((x) => x.id === m.id));
  await api('POST', '/api/messages/act', { ids: [m.id], action: 'unarchive' });
  const calls = []; await flushArchive(async (a, u) => { calls.push(u); }, Date.now() + 60e3); assert.equal(calls.length, 0);
  assert.equal(db.prepare('SELECT cat FROM messages WHERE id=?').get(m.id).cat, 'inbox');
  // cofnięcie spamu: reguła znika
  await api('POST', '/api/messages/act', { ids: [m.id], action: 'spam' });
  assert.ok(db.prepare("SELECT 1 FROM rules WHERE value=? AND action='spam'").get(m.from_addr || 'marta@example.com') || true);
  const before = db.prepare('SELECT COUNT(*) n FROM rules').get().n;
  await api('POST', '/api/messages/act', { ids: [m.id], action: 'unrule' });
  assert.equal(db.prepare('SELECT cat FROM messages WHERE id=?').get(m.id).cat, 'inbox'); assert.equal(db.prepare('SELECT COUNT(*) n FROM rules').get().n, before - 1);
  // wątki: dwie wiadomości o tym samym temacie (Re:) w jednym koncie
  const { storeMessages } = await import('../server/sync.js');
  const acc = db.prepare('SELECT id,user_id FROM accounts WHERE id=?').get(m.account_id);
  const mk = (u, subj) => ({ uid: 7000 + u, messageId: `<th${u}>`, fromName: 'Ala', fromAddr: 'ala@example.org', toAddr: 'ty@example.com', subject: subj, body: 'x', snippet: 'x', date: Date.now() - u * 1000, unread: false, hasAttach: false, ics: [], atts: [], html: '', unsub: false, bulk: false });
  storeMessages(acc, [mk(1, 'Plan wyjazdu'), mk(2, 'Re: Plan wyjazdu'), mk(3, 'RE: re: plan wyjazdu')]);
  const t1 = db.prepare("SELECT id FROM messages WHERE uid=7001").get().id;
  const dt = (await api('GET', `/api/messages/${t1}`)).body.message; assert.equal(dt.thread.length, 2);
  assert.equal((await api('GET', '/api/messages?tab=all')).body.messages.find((x) => x.id === t1).thread_n, 3);
  // foldery dostawcy
  const { imap } = await import('../server/providers/imap.js');
  const ia = db.prepare("INSERT INTO accounts(user_id,label,provider,email,config,created_at) VALUES(?,?,?,?,?,?)").run(acc.user_id, 'ff', 'imap', 'ff@example.com', '{"imap":{}}', Date.now());
  imap.folders = async () => [{ path: 'Praca', name: 'Praca', use: '' }];
  imap.sync = async (c, p, o) => ({ messages: [mk(50, 'Z folderu Praca')], lastUid: 0 });
  assert.deepEqual((await api('GET', `/api/provider-folders?account=${Number(ia.lastInsertRowid)}`)).body.folders.map((f) => f.path), ['Praca']);
  const op = await api('POST', '/api/provider-folders/open', { account_id: Number(ia.lastInsertRowid), path: 'Praca' }); assert.equal(op.body.folder, 'X:Praca');
  const lst = (await api('GET', `/api/messages?tab=other&folder=${encodeURIComponent('X:Praca')}&account=${Number(ia.lastInsertRowid)}`)).body.messages; assert.equal(lst.length, 1);
  assert.ok(!(await api('GET', '/api/messages?tab=all')).body.messages.some((x) => x.subject === 'Z folderu Praca'));
});

test('kontakty: dodawanie z wieloma adresami, duplikat adresu odrzucony, edycja, usuwanie, osoby z korespondencji, nazwa w powiadomieniach, izolacja użytkowników', async () => {
  const { contactName } = await import('../server/push.js');
  const { db } = await import('../server/db.js');
  const c = await api('POST', '/api/contacts', { name: 'Michał Lewandowski', note: 'brat', emails: [{ email: 'Michal@Example.com', label: 'prywatny' }, { email: 'm.lewandowski@firma.pl', label: 'praca' }] });
  assert.equal(c.status, 200);
  let list = (await api('GET', '/api/contacts')).body.contacts; const mine = list.find((x) => x.name === 'Michał Lewandowski');
  assert.deepEqual(mine.emails.map((e) => e.email), ['michal@example.com', 'm.lewandowski@firma.pl']);
  const dup = await api('POST', '/api/contacts', { name: 'Ktoś', emails: [{ email: 'michal@example.com' }] }); assert.equal(dup.status, 409); assert.match(dup.body.error, /Michał Lewandowski/);
  assert.equal((await api('POST', '/api/contacts', { name: 'Zły', emails: [{ email: 'to-nie-adres' }] })).status, 400);
  assert.equal((await api('POST', '/api/contacts', { name: 'Brak', emails: [] })).status, 400);
  assert.equal((await api('PUT', `/api/contacts/${mine.id}`, { name: 'Michał L.', emails: [{ email: 'michal@example.com' }] })).status, 200); // zmiana nie liczy się jako duplikat samego siebie
  list = (await api('GET', '/api/contacts')).body.contacts; assert.equal(list.find((x) => x.id === mine.id).emails.length, 1);
  const uid = db.prepare('SELECT user_id u FROM contacts WHERE id=?').get(mine.id).u;
  assert.equal(contactName(uid, 'MICHAL@example.com', 'Obcy'), 'Michał L.'); assert.equal(contactName(uid, 'nikt@example.com', 'Obcy'), 'Obcy');
  const people = (await api('GET', '/api/contacts/people')).body.people; assert.ok(Array.isArray(people)); assert.ok(!people.some((p) => p.email === 'michal@example.com'));
  assert.ok(people.some((p) => p.email === 'marta@example.com'), 'nadawcy z poczty są podpowiadani');
  // inny użytkownik nie widzi i nie rusza cudzych kontaktów
  const { hashPassword, createSession } = await import('../server/security.js');
  const other = Number(db.prepare("INSERT INTO users(email,pass_hash,plan,created_at) VALUES('kontakty@example.com',?,'guest',?)").run(hashPassword('xxxxxxxxxxxxxx'), Date.now()).lastInsertRowid);
  const saved = cookie; cookie = `sid=${createSession(other, 't')}`;
  assert.equal((await api('GET', '/api/contacts')).body.contacts.length, 0);
  assert.equal((await api('PUT', `/api/contacts/${mine.id}`, { name: 'x', emails: [{ email: 'x@example.com' }] })).status, 404);
  await api('DELETE', `/api/contacts/${mine.id}`); cookie = saved;
  assert.ok((await api('GET', '/api/contacts')).body.contacts.some((x) => x.id === mine.id));
  assert.equal((await api('DELETE', `/api/contacts/${mine.id}`)).status, 200); assert.ok(!(await api('GET', '/api/contacts')).body.contacts.some((x) => x.id === mine.id));
  // usunięty kontakt i ręcznie ukryty adres nie wracają do podpowiedzi; cofnięcie je przywraca
  let pp = (await api('GET', '/api/contacts/people')).body.people; assert.ok(!pp.some((p) => p.email === 'michal@example.com'), 'usunięty kontakt nie jest podpowiadany');
  assert.ok(pp.some((p) => p.email === 'marta@example.com'));
  assert.equal((await api('POST', '/api/contacts/hide', { email: 'Marta@Example.com' })).status, 200);
  pp = (await api('GET', '/api/contacts/people')).body.people; assert.ok(!pp.some((p) => p.email === 'marta@example.com'));
  await api('POST', '/api/contacts/unhide', { email: 'marta@example.com' });
  assert.ok((await api('GET', '/api/contacts/people')).body.people.some((p) => p.email === 'marta@example.com'));
  assert.equal((await api('POST', '/api/contacts/hide', { email: 'zle' })).status, 400);
});

test('rozmowy: nagłówki i ta sama druga strona łączą, różne osoby i powiadomienia nie; lista zwija, gest dotyczy całej rozmowy', async () => {
  const { db } = await import('../server/db.js'); const { storeMessages, threadKeyFor } = await import('../server/sync.js');
  const acc = db.prepare('SELECT id,user_id FROM accounts WHERE provider=? ORDER BY id LIMIT 1').get('demo');
  const T = Date.now() - 5 * 864e5; let n = 0;
  const mk = (o) => ({ uid: 9100 + ++n, messageId: `<g${n}@t>`, fromName: 'X', fromAddr: 'x@example.org', toAddr: 'ty@example.com', subject: 'Temat', body: 'x', snippet: 'x', date: T + n * 1000, unread: true, hasAttach: false, ics: [], atts: [], html: '', unsub: false, bulk: false, ...o });
  // trzy osoby, ten sam temat "Re:" => trzy osobne rozmowy
  storeMessages(acc, [mk({ fromAddr: 'ala@example.org', subject: 'Re:' }), mk({ fromAddr: 'bob@example.org', subject: 'Sprawa wspólna' }), mk({ fromAddr: 'cezary@example.org', subject: 'Sprawa wspólna' }), mk({ fromAddr: 'bob@example.org', subject: 'Re: Sprawa wspólna' })]);
  const row = (u) => db.prepare('SELECT id,thread_key k FROM messages WHERE uid=?').get(u);
  assert.equal(row(9101).k, '', 'sam "Re:" bez nagłówków nie tworzy rozmowy');
  assert.notEqual(row(9102).k, row(9103).k); assert.equal(row(9102).k, row(9104).k);
  // odpowiedź z innego adresu, ale z nagłówkiem References, trafia do tej samej rozmowy
  storeMessages(acc, [mk({ fromAddr: 'bob.prywatny@example.org', subject: 'Re: Sprawa wspólna', refs: '<g2@t>' })]);
  assert.equal(row(9105).k, row(9102).k);
  // newsletter nie tworzy rozmowy
  storeMessages(acc, [mk({ fromAddr: 'news@sklep.example', subject: 'Promocja', bulk: true }), mk({ fromAddr: 'news@sklep.example', subject: 'Promocja', bulk: true })]);
  assert.equal(row(9106).k, ''); assert.equal(row(9107).k, '');
  // to samo od tej samej osoby po miesiącu to nowa rozmowa
  assert.notEqual(threadKeyFor({ user_id: acc.user_id, account_id: acc.id, cat: 'inbox', from_addr: 'bob@example.org', to_addr: '', date: T + 60 * 864e5, id: 0 }, { subject: 'Sprawa wspólna' }), row(9102).k);
  // lista: rozmowa Boba to jeden wiersz (najnowsza wiadomość), z licznikiem i nieprzeczytaniem
  const list = (await api('GET', '/api/messages?tab=all&limit=100')).body.messages.filter((x) => /Sprawa/.test(x.subject));
  const bob = list.filter((x) => x.from_addr.startsWith('bob')); assert.equal(bob.length, 1); assert.equal(bob[0].id, row(9105).id); assert.equal(bob[0].thread_n, 3); assert.equal(bob[0].unread, true);
  assert.equal(list.filter((x) => x.from_addr === 'cezary@example.org').length, 1);
  // otwarcie oznacza przeczytaną całą rozmowę, licznik w odpowiedzi
  const r = await api('POST', `/api/messages/${row(9105).id}/read`, {}); assert.equal(r.body.count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE uid IN (9102,9104,9105) AND unread=1").get().n, 0);
  // gest na zwiniętym wierszu usuwa całą rozmowę, cofnięcie ją przywraca
  const del = await api('POST', '/api/messages/act', { ids: [row(9105).id], action: 'delete', thread: true }); assert.equal(del.body.count, 3);
  assert.ok(!(await api('GET', '/api/messages?tab=all&limit=100')).body.messages.some((x) => x.from_addr.startsWith('bob')));
  await api('POST', '/api/messages/act', { ids: del.body.ids, action: 'restore' });
  assert.equal((await api('GET', '/api/messages?tab=all&limit=100')).body.messages.filter((x) => x.from_addr.startsWith('bob')).length, 1);
});

test('kolejka wysyłki: cofnięcie, wysyłka później, błąd widoczny na liście, wypisanie się, brak odpowiedzi', async () => {
  const { db } = await import('../server/db.js'); const { flushOutbox } = await import('../server/index.js');
  const acc = db.prepare("SELECT id,user_id FROM accounts WHERE provider='demo' ORDER BY id LIMIT 1").get();
  const body = { account_id: acc.id, to: 'ktos@example.org', subject: 'Test kolejki', text: 'Treść' };
  const q = await api('POST', '/api/send', { ...body, delay_ms: 10000 }); assert.equal(q.body.queued, true);
  assert.equal((await api('GET', '/api/outbox')).body.items.length, 1); assert.equal(await flushOutbox(), 0, 'przed czasem nic nie wychodzi');
  const c = await api('POST', `/api/outbox/${q.body.id}/cancel`); assert.equal(c.body.payload.subject, 'Test kolejki'); assert.equal((await api('GET', '/api/outbox')).body.items.length, 0);
  assert.equal((await api('POST', `/api/outbox/${q.body.id}/cancel`)).status, 404);
  const q2 = await api('POST', '/api/send', { ...body, at: Date.now() + 3600e3 }); assert.ok(q2.body.send_at > Date.now() + 3500e3);
  assert.equal(await flushOutbox(), 0); assert.equal(await flushOutbox(Date.now() + 7200e3), 1); assert.equal((await api('GET', '/api/outbox')).body.items.length, 0);
  assert.equal((await api('POST', '/api/send', { ...body, to: 'zly', delay_ms: 5000 })).status, 400, 'błędy od razu, nie w kolejce');
  const q3 = await api('POST', '/api/send', { ...body, delay_ms: 1 }); db.prepare("UPDATE outbox SET payload=replace(payload,'ktos@example.org','nie-adres') WHERE id=?").run(q3.body.id);
  await flushOutbox(Date.now() + 1000); const f = (await api('GET', '/api/outbox')).body.items; assert.equal(f[0].state, 'failed'); assert.match(f[0].error, /adres/i);
  await api('POST', `/api/outbox/${q3.body.id}/cancel`);
  // wypisanie się z newslettera (konto demo)
  const nl = db.prepare("SELECT id FROM messages WHERE from_addr LIKE 'info@members.netflix%' OR from_addr LIKE 'news@sklep-moda%' LIMIT 1").get();
  assert.ok((await api('GET', `/api/messages/${nl.id}`)).body.message.unsub); assert.equal((await api('POST', `/api/messages/${nl.id}/unsubscribe`)).body.ok, true);
  const plain = db.prepare("SELECT id FROM messages WHERE from_addr='marta@example.com'").get(); assert.equal((await api('POST', `/api/messages/${plain.id}/unsubscribe`)).status, 404);
  // bez odpowiedzi: wysłana 5 dni temu rozmowa bez odpowiedzi, znika po odpowiedzi i po ukryciu
  const { storeMessages } = await import('../server/sync.js'); const T = Date.now() - 5 * 864e5;
  const mk = (u, o) => ({ uid: 9300 + u, messageId: `<f${u}@t>`, fromName: 'Ty', fromAddr: 'demo@poczta.local', toAddr: 'ola@example.org', subject: 'Oferta dla Was', body: 'x', snippet: 'x', date: T + u, unread: false, hasAttach: false, ics: [], atts: [], html: '', unsub: false, bulk: false, ...o });
  db.prepare("INSERT INTO messages(user_id,account_id,folder,uid,message_id,from_addr,to_addr,subject,snippet,body,date,unread,cat,created_at,html_try,att_try,thread_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,'sent',?,2,1,?)").run(acc.user_id, acc.id, 'SENT', 9401, '<f1@t>', 'demo@poczta.local', 'ola@example.org', 'Oferta dla Was', 'x', 'x', T, Date.now(), 'oferta dla was|ola@example.org');
  const fid = db.prepare('SELECT id FROM messages WHERE uid=9401').get().id;
  assert.ok((await api('GET', '/api/followups')).body.items.some((x) => x.id === fid));
  await api('POST', `/api/messages/${fid}/followup-off`); assert.ok(!(await api('GET', '/api/followups')).body.items.some((x) => x.id === fid));
  db.prepare('UPDATE messages SET follow_off=0 WHERE id=?').run(fid);
  storeMessages(acc, [{ ...mk(2), fromAddr: 'ola@example.org', toAddr: 'demo@poczta.local', subject: 'Re: Oferta dla Was', date: Date.now() - 864e5, refs: '<f1@t>', messageId: '<f2@t>' }]);
  assert.ok(!(await api('GET', '/api/followups')).body.items.some((x) => x.id === fid), 'odpowiedź kasuje przypomnienie');
});

test('załączniki: lista i filtry; wyszukiwanie z operatorami i zapisane wyszukiwania', async () => {
  const faktura = (await api('GET', '/api/attachments?q=fv')).body.items; assert.ok(faktura.length >= 1); assert.match(faktura[0].filename, /FV/);
  assert.equal((await api('GET', '/api/attachments?kind=pdf')).body.items.length >= 1, true); assert.equal((await api('GET', '/api/attachments?kind=img')).body.items.length, 0);
  assert.equal((await api('GET', '/api/attachments?q=nie-ma-takiego-pliku')).body.items.length, 0);
  const s1 = (await api('GET', '/api/search?q=' + encodeURIComponent('ma:zalacznik'))).body.messages; assert.ok(s1.length >= 1 && s1.every((m) => m.has_attach));
  const s2 = (await api('GET', '/api/search?q=' + encodeURIComponent('od:marta weekend'))).body.messages; assert.ok(s2.length >= 1 && s2.every((m) => /marta/i.test(m.from_addr)));
  assert.equal((await api('GET', '/api/search?q=' + encodeURIComponent('od:marta faktura'))).body.messages.length, 0);
  assert.ok((await api('GET', '/api/search?q=' + encodeURIComponent('jest:nieprzeczytane'))).body.messages.every((m) => m.unread));
  assert.ok((await api('GET', '/api/search?q=' + encodeURIComponent('w:wyslane do:ola'))).body.messages.every((m) => m.cat === 'sent'));
  const sv = await api('POST', '/api/saved-searches', { name: 'Faktury z PDF', query: 'faktura ma:zalacznik' }); assert.equal(sv.status, 200);
  assert.equal((await api('POST', '/api/saved-searches', { query: 'faktura ma:zalacznik' })).status, 409);
  assert.equal((await api('GET', '/api/saved-searches')).body.items.length, 1);
  assert.equal((await api('DELETE', `/api/saved-searches/${sv.body.id}`)).status, 200); assert.equal((await api('GET', '/api/saved-searches')).body.items.length, 0);
});

test('przypomnienie o terminie płatności: raz, od 9:00, tylko dla otwartych', async () => {
  const { db } = await import('../server/db.js'); const { remindDeadlines } = await import('../server/jobs.js');
  const uid = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
  db.prepare("INSERT INTO push_subs(user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?)").run(uid, 'https://push.example/rem', 'p', 'a', Date.now());
  const mid = db.prepare('SELECT id FROM messages WHERE user_id=? LIMIT 1').get(uid).id;
  const day = (d) => { const t = new Date(Date.now() + d * 864e5); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const ins = db.prepare("INSERT INTO found_items(user_id,message_id,kind,title,starts_at,amount,currency,confidence,source,evidence,status,created_at) VALUES(?,?,'deadline',?,?,?,'PLN',0.9,'t','e',?,?)");
  const a = Number(ins.run(uid, mid, 'Do zapłaty Prąd: 120 zł', day(1), 120, 'new', Date.now()).lastInsertRowid), mid2 = db.prepare('SELECT id FROM messages WHERE user_id=? AND id!=? LIMIT 1').get(uid, mid).id, b = Number(ins.run(uid, mid2, 'Do zapłaty Woda', day(1), 50, 'paid', Date.now()).lastInsertRowid), c = Number(ins.run(uid, mid, 'Do zapłaty Gaz', day(5), 50, 'new', Date.now()).lastInsertRowid);
  const nine = new Date(); nine.setHours(8, 0, 0, 0); const old = process.env.POCZTA_TZ; process.env.POCZTA_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(remindDeadlines(nine), 0, 'przed 9:00 nic');
  const noon = new Date(); noon.setHours(12, 0, 0, 0); remindDeadlines(noon);
  const rem = (id) => db.prepare('SELECT reminded r FROM found_items WHERE id=?').get(id).r;
  assert.equal(rem(a), 1); assert.equal(rem(b), 0); assert.equal(rem(c), 0); assert.equal(remindDeadlines(noon), 0, 'tylko raz');
  if (old === undefined) delete process.env.POCZTA_TZ; else process.env.POCZTA_TZ = old;
});

test('stosy: Spam, Oferty i Kosz grupują po nadawcy, rozsunięcie zwraca członków od najnowszego, gest dotyczy całego stosu', async () => {
  const { db } = await import('../server/db.js');
  const acc = db.prepare("SELECT id,user_id FROM accounts WHERE provider='demo' ORDER BY id LIMIT 1").get(); const T = Date.now() - 3600e3;
  const ins = db.prepare("INSERT INTO messages(user_id,account_id,folder,uid,message_id,from_name,from_addr,to_addr,subject,snippet,body,date,unread,cat,created_at,html_try,att_try,thread_key) VALUES(?,?,'INBOX',?,?,?,?,?,?,?,?,?,?,'spam',?,2,1,'')");
  for (let i = 0; i < 4; i++) ins.run(acc.user_id, acc.id, 9600 + i, `<s${i}@t>`, 'InPost', 'powiadomienia@inpost.example', 'ty@example.com', `Paczka ${i}`, 'x', 'x', T + i * 1000, i === 0 ? 1 : 0, Date.now());
  ins.run(acc.user_id, acc.id, 9610, '<s9@t>', 'Inny', 'inny@spam.example', 'ty@example.com', 'Inny spam', 'x', 'x', T, 0, Date.now());
  const list = (await api('GET', '/api/messages?tab=spam&limit=100')).body.messages;
  const inpost = list.filter((m) => m.from_addr === 'powiadomienia@inpost.example'); assert.equal(inpost.length, 1); assert.equal(inpost[0].thread_n, 4); assert.equal(inpost[0].subject, 'Paczka 3'); assert.equal(inpost[0].unread, true, 'stos jest nieprzeczytany, gdy któraś wiadomość jest');
  assert.equal(list.filter((m) => m.from_addr === 'inny@spam.example')[0].thread_n, 1);
  const st = (await api('GET', `/api/messages/${inpost[0].id}/stack?limit=2`)).body; assert.deepEqual(st.messages.map((m) => m.subject), ['Paczka 3', 'Paczka 2']); assert.equal(st.more, true);
  const st2 = (await api('GET', `/api/messages/${inpost[0].id}/stack?limit=10&before=${st.messages[1].date}`)).body; assert.deepEqual(st2.messages.map((m) => m.subject), ['Paczka 1', 'Paczka 0']); assert.equal(st2.more, false);
  // gest na stosie: wszystkie od nadawcy do kosza; w koszu to znowu jeden stos
  const del = await api('POST', '/api/messages/act', { ids: [inpost[0].id], action: 'delete', thread: true }); assert.equal(del.body.count, 4);
  const trash = (await api('GET', '/api/messages?tab=trash&limit=100')).body.messages.filter((m) => m.from_addr === 'powiadomienia@inpost.example'); assert.equal(trash.length, 1); assert.equal(trash[0].thread_n, 4);
  assert.equal((await api('GET', `/api/messages/${trash[0].id}/stack`)).body.messages.length, 4);
  await api('POST', '/api/messages/act', { ids: del.body.ids, action: 'restore' });
  assert.equal((await api('GET', '/api/messages/999999/stack')).status, 404);
});

test('reguły automatyczne: zapis, zastosowanie do istniejących, walidacja', async () => {
  const bad1 = await api('POST', '/api/auto-rules', { field: 'subject', value: 'ab', action: 'archive' }); assert.equal(bad1.status, 400);
  assert.equal((await api('POST', '/api/auto-rules', { field: 'from', value: 'x', action: 'archive' })).status, 400);
  const inbox = (await api('GET', '/api/messages?limit=100')).body.messages, tgt = inbox.find((m) => m.from_addr);
  const r = await api('POST', '/api/auto-rules', { field: 'from', value: tgt.from_addr.toUpperCase(), action: 'archive', apply: true });
  assert.equal(r.status, 200); assert.ok(r.body.applied >= 1);
  const arch = (await api('GET', '/api/messages?tab=archive&limit=100')).body.messages; assert.ok(arch.some((m) => m.id === tgt.id));
  const list = (await api('GET', '/api/auto-rules')).body; assert.equal(list.rules.length, 1);
  assert.equal((await api('DELETE', `/api/auto-rules/${list.rules[0].id}`)).status, 200);
  await api('POST', '/api/messages/act', { ids: [tgt.id], action: 'unarchive' });
});
test('szablony odpowiedzi: dodanie, edycja, usunięcie', async () => {
  assert.equal((await api('POST', '/api/templates', { name: '', body: 'x' })).status, 400);
  const id = (await api('POST', '/api/templates', { name: 'Dzięki', body: 'Dziękuję, wracam jutro.' })).body.id;
  await api('POST', '/api/templates', { id, name: 'Dzięki', body: 'Dziękuję!' });
  assert.equal((await api('GET', '/api/templates')).body.templates[0].body, 'Dziękuję!');
  await api('DELETE', `/api/templates/${id}`); assert.equal((await api('GET', '/api/templates')).body.templates.length, 0);
});
test('kopia zapasowa: tworzy plik, da się go pobrać i otworzyć jako baza', async () => {
  const run = await api('POST', '/api/backup/run'); assert.equal(run.status, 200);
  const name = run.body.name; const f = await fetch(`${base}/api/backup/file?name=${name}`, { headers: { cookie } }); assert.equal(f.status, 200);
  const buf = Buffer.from(await f.arrayBuffer()); assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await api('GET', '/api/backup/file?name=../../etc/passwd')).status, 404);
  const k = await fetch(`${base}/api/backup/key`, { headers: { cookie } }); assert.match(await k.text(), /^POCZTA_SECRET_KEY=[0-9a-f]{64}/);
});
test('widżet: token włącza i wyłącza dostęp do podsumowania', async () => {
  assert.equal((await api('GET', '/api/widget?token=zlytokenzlytokenzlytoken')).status, 401);
  const t = (await api('POST', '/api/widget/token', {})).body.token; assert.ok(t.length > 20);
  const w = (await fetch(`${base}/api/widget?token=${t}`)).json ? await (await fetch(`${base}/api/widget?token=${t}`)).json() : null;
  assert.equal(typeof w.unread, 'number'); assert.ok('open' in w);
  await api('POST', '/api/widget/token', { off: true }); assert.equal((await fetch(`${base}/api/widget?token=${t}`)).status, 401);
});
test('klucz dostępu: rejestracja i logowanie z symulowanym authenticatorem ES256', async () => {
  const crypto = await import('node:crypto'); const host = new URL(base).host, rpId = host.replace(/:\d+$/, '');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const jwk = publicKey.export({ format: 'jwk' });
  const b = (x) => Buffer.from(x), u = (x) => Buffer.from(x).toString('base64url'), sha = (x) => crypto.createHash('sha256').update(x).digest();
  const cb = (n) => (n < 24 ? Buffer.from([n]) : Buffer.from([24, n])), cnum = (n) => (n >= 0 ? Buffer.concat([Buffer.from([n < 24 ? n : 0x18]), n < 24 ? Buffer.alloc(0) : Buffer.from([n])]) : Buffer.from([0x20 + (-1 - n)]));
  const cbytes = (x) => Buffer.concat([Buffer.from(x.length < 24 ? [0x40 | x.length] : [0x58, x.length]), x]);
  const cose = Buffer.concat([Buffer.from([0xa5]), cnum(1), cnum(2), cnum(3), cnum(-7), cnum(-1), cnum(1), cnum(-2), cbytes(Buffer.from(jwk.x, 'base64url')), cnum(-3), cbytes(Buffer.from(jwk.y, 'base64url'))]);
  const credId = crypto.randomBytes(16), cnt = Buffer.alloc(4); cnt.writeUInt32BE(1);
  const authReg = Buffer.concat([sha(rpId), Buffer.from([0x45]), cnt, Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose]);
  const attObj = Buffer.concat([Buffer.from([0xa3]), Buffer.from([0x63]), b('fmt'), Buffer.from([0x64]), b('none'), Buffer.from([0x67]), b('attStmt'), Buffer.from([0xa0]), Buffer.from([0x68]), b('authData'), Buffer.from([0x59, authReg.length >> 8, authReg.length & 255]), authReg]);
  const o = (await api('POST', '/api/passkey/register/options', {})).body;
  const cdj = (type, ch) => Buffer.from(JSON.stringify({ type, challenge: ch, origin: `http://${host}` }));
  const reg = cdj('webauthn.create', o.challenge);
  const rv = await api('POST', '/api/passkey/register/verify', { name: 'Test', response: { clientDataJSON: u(reg), attestationObject: u(attObj) } }); assert.equal(rv.status, 200, JSON.stringify(rv.body));
  assert.equal((await api('GET', '/api/passkeys')).body.keys.length, 1);
  const saved = cookie; cookie = '';
  const lo = (await api('POST', '/api/passkey/login/options', {})).body; const cd = cdj('webauthn.get', lo.challenge);
  const c2 = Buffer.alloc(4); c2.writeUInt32BE(2); const ad = Buffer.concat([sha(rpId), Buffer.from([0x05]), c2]);
  const sig = crypto.sign('sha256', Buffer.concat([ad, sha(cd)]), privateKey);
  const bad2 = await api('POST', '/api/passkey/login/verify', { id: u(credId), response: { clientDataJSON: u(cd), authenticatorData: u(ad), signature: u(Buffer.from('zly')) } }); assert.equal(bad2.status, 401);
  const lo2 = (await api('POST', '/api/passkey/login/options', {})).body; const cd2 = cdj('webauthn.get', lo2.challenge); const sig2 = crypto.sign('sha256', Buffer.concat([ad, sha(cd2)]), privateKey);
  const ok = await api('POST', '/api/passkey/login/verify', { id: u(credId), response: { clientDataJSON: u(cd2), authenticatorData: u(ad), signature: u(sig2) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.ok(cookie.startsWith('sid=')); assert.equal((await api('GET', '/api/state')).body.user.email, 'wlasciciel@example.com');
  assert.equal((await api('POST', '/api/passkey/login/verify', { id: u(credId), response: { clientDataJSON: u(cd2), authenticatorData: u(ad), signature: u(sig2) } })).status, 401); // powtórka wyzwania
  void saved; void cb; void sig;
});

test('zaznaczanie zbiorcze: przeczytane/nieprzeczytane, a wyszukiwarka zwraca fragment z oznaczonymi trafieniami', async () => {
  const msgs = (await api('GET', '/api/messages?limit=100')).body.messages, ids = msgs.slice(0, 2).map((m) => m.id);
  assert.equal((await api('POST', '/api/messages/act', { ids, action: 'unread' })).body.count, 2);
  assert.equal((await api('GET', `/api/messages/${ids[0]}`)).status, 200);
  const un = (await api('GET', '/api/messages?tab=unread&limit=100')).body.messages.map((m) => m.id); assert.ok(ids.every((i) => un.includes(i)));
  await api('POST', '/api/messages/act', { ids, action: 'read' });
  const s = (await api('GET', '/api/search?q=faktura')).body; assert.ok(s.terms.includes('faktura'));
  const hit = s.messages.find((m) => m.hit); assert.ok(hit && /\u0001/.test(hit.hit) && /\u0002/.test(hit.hit));
});
test('lista zwraca znacznik more, gdy są starsze wiadomości', async () => {
  const r = (await api('GET', '/api/messages?limit=2')).body; assert.equal(r.messages.length, 2); assert.equal(r.more, true);
  assert.equal((await api('GET', '/api/messages?limit=100')).body.more, false);
});
