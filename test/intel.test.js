import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDates } from '../server/intel/dates.js';
import { extractItems, parseIcs } from '../server/intel/extract.js';

const NOW = new Date(2026, 9, 23, 8, 44); // pt 23.10.2026

test('data numeryczna z godziną', () => {
  const [d] = extractDates('Wizyta w środę 28.10 o 17:30 w przychodni', NOW);
  assert.equal(d.ymd, '2026-10-28'); assert.equal(d.sh, 17); assert.equal(d.sm, 30);
});
test('słowna data i zakres godzin', () => {
  const [d] = extractDates('Spotkanie 5 listopada, godz. 14–16', NOW);
  assert.equal(d.ymd, '2026-11-05'); assert.equal(d.sh, 14); assert.equal(d.eh, 16);
});
test('względne: dziś, jutro, dzień tygodnia', () => {
  assert.equal(extractDates('Paczka dotrze dziś 14-16', NOW)[0].ymd, '2026-10-23');
  assert.equal(extractDates('widzimy się jutro o 9', NOW)[0].ymd, '2026-10-24');
  assert.equal(extractDates('spotkanie w czwartek o 10:00', NOW)[0].ymd, '2026-10-29');
});
test('cena nie jest datą', () => {
  assert.equal(extractDates('Razem 12.50 zł oraz 1.240,00 zł', NOW).length, 0);
});
test('przejście roku: grudzień → styczeń', () => {
  assert.equal(extractDates('Termin 10.01', new Date(2026, 11, 20))[0].ymd, '2027-01-10');
});
test('dzień tygodnia przed datą nie tworzy duplikatu', () => {
  assert.equal(extractDates('w środę 28.10 o 17:30', NOW).length, 1);
});

test('faktura → termin z kwotą', () => {
  const items = extractItems({ subject: 'Faktura FV/10/2026 do opłaty', body: 'Kwota do zapłaty: 1 240,00 zł. Termin płatności 4.11.2026.', fromName: 'Biuro Rachunkowe' }, NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'deadline'); assert.equal(items[0].starts_at, '2026-11-04'); assert.equal(items[0].amount, 1240);
});
test('przesyłka dziś w oknie godzin', () => {
  const [it] = extractItems({ subject: 'Twoja paczka dotrze dziś', body: 'Kurier doręczy przesyłkę dziś w godzinach 14–16.', fromName: 'Kurier Express' }, NOW);
  assert.equal(it.kind, 'parcel'); assert.equal(it.starts_at, '2026-10-23T14:00'); assert.equal(it.ends_at, '2026-10-23T16:00');
});
test('wizyta', () => {
  const [it] = extractDates && extractItems({ subject: 'Potwierdzenie wizyty – kardiolog', body: 'Wizyta odbędzie się 28.10.2026 o godz. 17:30.' }, NOW);
  assert.equal(it.kind, 'event'); assert.equal(it.starts_at, '2026-10-28T17:30');
});
test('data wysyłki w przeszłości jest pomijana, zwykły tekst nie daje spraw', () => {
  assert.equal(extractItems({ subject: 'Newsletter', body: 'Wysłano 12.10. Pozdrawiamy.' }, NOW).length, 0);
  assert.equal(extractItems({ subject: 'Hej', body: 'Co słychać? Pozdrawiam' }, NOW).length, 0);
});
test('ICS ma pierwszeństwo i pełną pewność', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Planowanie\r\nDTSTART:20261029T100000\r\nDTEND:20261029T110000\r\nLOCATION:Sala 3\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.equal(parseIcs(ics).length, 1);
  const [it] = extractItems({ subject: 'Zaproszenie', body: '', ics: [ics] }, NOW);
  assert.equal(it.source, 'ics'); assert.equal(it.starts_at, '2026-10-29T10:00'); assert.equal(it.location, 'Sala 3');
});

import { classify } from '../server/intel/classify.js';
test('klasyfikacja: reklamy trafiają do ofert, ważne zostają w skrzynce', () => {
  const offer = classify({ fromAddr: 'sklep@shav.example', fromName: 'SHAV', subject: '🔍 Zajrzyj do SHAV 2 - Maszynka do Golenia | WYGRAJ BILETY', body: 'Nowość! Sprawdź nasz sklep. Konkurs trwa do 11.02. Wypisz się z newslettera.', bulk: true });
  assert.equal(offer.cat, 'offers');
  assert.equal(classify({ fromAddr: 'x@allegro.example', fromName: 'Allegro Pay', subject: 'Zapłać później, -20% na wszystko', body: 'Kod rabatowy tylko do piątku. Darmowa dostawa. Wypisz się.' }).cat, 'offers');
  assert.equal(classify({ fromAddr: 'biuro@ksiegowosc.example', subject: 'Faktura nr FV/10/2026', body: 'Kwota do zapłaty 1 240 zł, termin płatności 4.11.' }).cat, 'inbox');
  assert.equal(classify({ fromAddr: 'marta@gmail.com', subject: 'Re: weekend', body: 'Hej, pasuje Ci sobota?' }).cat, 'inbox');
  assert.equal(classify({ fromAddr: 'k@kurier.example', subject: 'Twoja paczka jest w drodze', body: 'Numer przesyłki 123. Wypisz się z powiadomień marketingowych.', unsub: true }).cat, 'inbox'); // transakcyjne z linkiem wypisania
  assert.equal(classify({ fromAddr: 'a@b.example', subject: 'Kasyno online: bonus 500 zł', body: 'Gratulujemy wygranej! Zagraj teraz.' }).cat, 'spam');
  assert.equal(classify({ fromAddr: 'x@y.xyz', subject: 'Pilne', body: 'x', risk: 2 }).cat, 'spam');
});
test('klasyfikacja: reguły użytkownika wygrywają, domena i nadawca', () => {
  const rules = [{ kind: 'sender', value: 'ok@sklep.example', action: 'inbox' }, { kind: 'domain', value: 'sklep.example', action: 'block' }, { kind: 'sender', value: 'a@x.example', action: 'spam' }];
  assert.equal(classify({ fromAddr: 'ok@sklep.example', subject: '-50% kod rabatowy', body: 'wypisz się', bulk: true }, rules).cat, 'inbox');
  assert.equal(classify({ fromAddr: 'inny@sklep.example', subject: 'cześć', body: 'hej' }, rules).cat, 'blocked');
  assert.equal(classify({ fromAddr: 'A@x.example', subject: 'cześć', body: 'hej' }, rules).cat, 'spam');
});
test('sprawy: reklamy i "darmowa dostawa" nie tworzą spraw', () => {
  const now = new Date('2026-10-23T10:00:00');
  assert.equal(extractItems({ subject: 'Darmowa dostawa do 31.10!', body: 'Promocja trwa do 31.10. Kup teraz.', received: now }, now).length, 0);
  assert.equal(extractItems({ subject: 'Paczka od Allegro Pay', body: 'Zamów do 5.11 z darmową dostawą, kod rabatowy -10%.', received: now }, now).length, 0);
  assert.equal(extractItems({ subject: 'Twoja paczka', body: 'Paczka zostanie dostarczona 28.10 w godz. 14-16 przez kuriera.', received: now }, now)[0]?.kind, 'parcel');
});

import { cleanHtml, frameDoc } from '../server/intel/mailhtml.js';
import { isPrivateAddr } from '../server/imgproxy.js';
test('HTML maila: zostaje układ i obrazki przez proxy, znikają skrypty, formularze i piksele śledzące', () => {
  const h = '<html><head><style>.a{background:url(https://cdn.x/b.png)}</style><script>alert(1)</script></head><body bgcolor="#000"><table width="600" onclick="x()"><tr><td background="https://cdn.x/bg.jpg"><img src="https://cdn.x/p.jpg?a=1&b=2" width="300"><img src="https://t.example/track/open.gif" width="1" height="1"><a href="javascript:alert(1)">zły</a><a href="https://ok.example/x">dobry</a><form action="x"><input name="a"></form><iframe src="x"></iframe></td></tr></table></body></html>';
  const r = cleanHtml(h);
  assert.match(r.html, /<table width="600">/); assert.doesNotMatch(r.html, /onclick|<script|<iframe|<form|<input|javascript:|track\/open/);
  assert.match(r.html, /src="api\/img\?u=https%3A%2F%2Fcdn\.x%2Fp\.jpg/); assert.match(r.html, /background-color:#000/);
  assert.match(r.html, /<a href="https:\/\/ok\.example\/x" target="_blank" rel="noopener noreferrer nofollow">dobry/);
  assert.doesNotMatch(cleanHtml(h, { images: false }).html, /api\/img/);
  assert.match(frameDoc(r.html), /default-src 'none'; img-src 'self' data:/);
});
test('proxy obrazków: adresy prywatne odrzucone', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) assert.equal(isPrivateAddr(a), true, a);
  for (const a of ['8.8.8.8', '151.101.1.1', '2a00:1450:4001::1']) assert.equal(isPrivateAddr(a), false, a);
});
