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
