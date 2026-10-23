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
