# Poczta

Klient poczty jako PWA na ekran początkowy iPhone'a. Działa z dowolną skrzynką (IMAP/SMTP), sam znajduje terminy,
płatności i paczki w wiadomościach i dodaje je do Kalendarza po Twoim potwierdzeniu. Motyw wizualny: **Noc**.

## Co działa (etap 1)
- Skrzynka, wątek, odpowiadanie i wysyłka, wyszukiwanie pełnotekstowe (bez względu na polskie znaki), widok „Dziś".
- **Sprawy**: wykrywanie dat po polsku (dziś/jutro/dzień tygodnia, 28.10, 5 listopada, zakresy godzin 14–16), zaproszeń `.ics`,
  faktur z kwotą, przesyłek. Pierścień pilności na każdej wiadomości.
- **Kalendarz**: link do aplikacji Kalendarz albo plik `.ics`. Nic nie jest dodawane bez potwierdzenia (patrz `docs/kalendarz-patch.md`).
- **Ochrona przed oszustwem**: lokalne sygnały (domena, presja czasu, prośba o dane). Z podejrzanych wiadomości nie wyciągamy terminów.
- **Nowe wiadomości na żywo** (IMAP IDLE, z automatycznym ponawianiem) i **powiadomienia push** na iPhone'a (iOS 16.4+, po dodaniu do ekranu początkowego). Powiadomienie niesie też wykryty termin.
- Dostawcy: IMAP/SMTP (Gmail i iCloud przez hasło aplikacji, WP, O2, Onet, Interia i inne) + konto demo.
- Prywatność: hasła skrzynek szyfrowane AES-256-GCM, fonty i skrypty lokalne, brak zewnętrznych wywołań. Treści nie opuszczają serwera.
- Gotowe pod sprzedaż: `user_id` w każdej tabeli, interfejs adaptera dostawcy, konfiguracja z env, dziennik audytu, migracje, limity, testy.

## Uruchomienie lokalne
```bash
npm install
npm test
npm start        # http://127.0.0.1:8792  (tryb demo: przycisk w zakładce Konta)
```
Zmienne środowiskowe: `POCZTA_PORT`, `POCZTA_DATA`, `POCZTA_BASE` (np. `/poczta`), `POCZTA_SETUP_CODE`, `POCZTA_SECRET_KEY`,
`POCZTA_MAX_USERS`, `POCZTA_DEMO`, `KALENDARZ_URL`. Wymaga Node 22+ (używa wbudowanego `node:sqlite`).

## Wdrożenie na VPS (jak Typer / Egida / Kalendarz)
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/poczta/main/deploy/install.sh)
```
Osobny użytkownik, `/opt/poczta`, usługa na `127.0.0.1:8792` z limitem 220 MB RAM, trasa `/poczta/` w Caddy z walidacją i wycofaniem.
Instalator wypisze adres i kod instalacji. Skopiuj `/etc/poczta.env` w bezpieczne miejsce (klucz szyfrowania haseł).
**Uwaga:** VPS ma ~80% dysku zajęte; instalator odmówi, jeśli wolnego miejsca jest mniej niż 300 MB.

## Struktura
```
server/   index.js (API+statyka) · db.js (migracje) · security.js · sync.js
          providers/ (imap, demo, presets) · intel/ (dates, extract, risk) · calendar.js
web/      index.html · app.js · styles.css · sw.js · manifest · fonts · icons
test/     intel.test.js · api.test.js
deploy/   install.sh
```

## Dalsze etapy
2. Logowanie Google/Microsoft przez OAuth (bez haseł aplikacji), poranne i wieczorne podsumowania push, przypomnienia o terminach.
3. Gemini (płatny klucz, na żądanie, z dziennikiem AI) do trudniejszych dat i szkiców odpowiedzi. Odpowiedź głosem, odkładanie, zobowiązania.
4. Passkey/Face ID, HTML wiadomości w piaskownicy (bez zdalnych obrazów), załączniki, wiele użytkowników, rozliczenia.

## Etap 2

- **Odkładanie**: przeciągnięcie wiadomości w lewo (lub zegar w wątku) odkłada ją na wieczór, jutro rano, weekend, za tydzień albo na własny termin. Wraca na górę jako nowa, z powiadomieniem. Przeciągnięcie w prawo oznacza ją jako przeczytaną.
- **Płatności**: zakładka z sumą do zapłaty, podziałem na „po terminie / w tym tygodniu / później" i przyciskiem „Opłacone".
- **Przeglądy**: poranne (sprawy na dziś, płatności tygodnia, nieprzeczytane) i wieczorne (plan na jutro) powiadomienie push. Wybierasz godzinę albo wyłączasz w Konta i prywatność. Gdy nic nie czeka, nie przychodzi. Strefa czasowa: `POCZTA_TZ` (domyślnie Europe/Warsaw).
