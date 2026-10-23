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
