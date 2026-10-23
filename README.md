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

## Etap 3: porządek w poczcie

- **Foldery**: Skrzynka (ważne), Oferty (reklamy, newslettery), Spam (oszustwa i śmieci), Odłożone, Kosz (30 dni). Oferty i Spam nie powiadamiają, nie liczą się do nieprzeczytanych i nie tworzą spraw ani płatności.
- **Sortowanie**: lokalne heurystyki (nagłówki masowej wysyłki, język promocji, typowe treści spamu, ochrona przed oszustwem) z ochroną wiadomości ważnych (faktury, kody, przesyłki, wizyty). Po aktualizacji cała istniejąca poczta jest sortowana raz automatycznie, a w Konta → Porządek w poczcie można ją posortować ponownie.
- **Reguły nadawców**: oznaczenie „To spam", „To oferta", „Zostaw w skrzynce" albo „Zablokuj" (nadawcę lub całą domenę, poza publiczną pocztą) zapamiętuje decyzję. Ręczne decyzje wygrywają z heurystyką, a blokada ukrywa wiadomości w każdej zakładce i wyszukiwarce.
- **Gesty**: w lewo usuwa (z „Cofnij"), w prawo oznacza jako spam (w Spamie i Ofertach: do skrzynki, w koszu: przywróć). Folder Oferty i Spam ma przycisk „Usuń wszystkie".
- **Usuwanie u dostawcy**: po krótkiej karencji na „Cofnij" wiadomość trafia do kosza u dostawcy poczty (odwracalnie przez jego ok. 30 dni). Można to wyłączyć w Konta → Porządek w poczcie. Poczta nigdy nie usuwa wiadomości trwale u dostawcy.

## Wiadomości HTML: tak, jak zostały nadane

- Poczta zapisuje oryginalny HTML wiadomości (skompresowany) i wyświetla go w izolowanej ramce: bez skryptów, formularzy i osadzeń, z polityką CSP dopuszczającą tylko obrazki. Szerokie maile (np. 600 px) są zmniejszane do szerokości ekranu. Przełącznik „Oryginał / Tekst" zapamiętuje wybór.
- Obrazki pobiera serwer, nie telefon (nadawca nie widzi Twojego adresu IP ani urządzenia). Proxy łączy się wyłącznie z internetem publicznym (ochrona przed SSRF i DNS rebinding), przyjmuje tylko obrazy rastrowe i ogranicza rozmiar. Piksele śledzące (1×1, znane wzorce adresów) w ogóle nie są pobierane, więc nadawca nie dowie się, że mail został otwarty. Wyłączysz obrazki w Konta → Porządek w poczcie, a w wątku jest „Pokaż obrazki".
- Starsze wiadomości, pobrane zanim zapisywaliśmy HTML, są dociągane z serwera poczty przy pierwszym otwarciu.


## Zaproszenia (więcej niż jedna osoba)

Właściciel: **Skrzynki → Osoby → Zaproś osobę**. Powstaje jednorazowy link (`#/join/…`, ważny 7 dni). Osoba zakłada własne konto,
dodaje własną skrzynkę i ma własne powiadomienia, reguły i dane. Właściciel nie widzi jej poczty. Limity (zmienne w `/etc/poczta.env`):
`POCZTA_MAX_GUESTS` (domyślnie 3 osoby) i `POCZTA_GUEST_ACCOUNTS` (domyślnie 3 skrzynki na osobę). Usunięcie osoby kasuje jej dane.
Uwaga: administrator serwera technicznie ma dostęp do bazy i klucza szyfrującego, więc zaproszone osoby powinny o tym wiedzieć.

## Załączniki, Wysłane, Szkice, starsza poczta

- **Załączniki**: lista pod nagłówkiem wiadomości; obrazy i PDF otwierają się w podglądzie, reszta pobiera się jako plik. Treść pobierana jest z serwera poczty na żądanie (limit 40 MB), małe obrazki inline (`cid:`) są zapisane i widać je w oryginale maila.
- **Wysłane i Szkice**: osobne zakładki, synchronizowane co najwyżej co 90 s. Szkic otwiera się do edycji i wysyłki. Usunięcie wiadomości z tych folderów przenosi ją do kosza u dostawcy z właściwego folderu.
- **Starsza poczta**: przycisk „Wczytaj starsze” najpierw stronicuje to, co jest lokalnie, a potem dociąga kolejne 60 wiadomości z serwera poczty.

## Pisanie i porządkowanie (etap 5)

- **Kompozytor**: Do / Dw / UDW, odpowiedz wszystkim, przekaż dalej (z załącznikami oryginału), własne załączniki (do 10 MB razem), podpis (Konta → Podpis), zapis szkicu u dostawcy (Szkic).
- **Gwiazdki i Archiwum**: gwiazdka synchronizuje się z flagą `\Flagged`; archiwizacja przenosi wiadomość do archiwum dostawcy po 12 s karencji (można cofnąć).
- **Foldery dostawcy**: chip „Foldery…” otwiera dowolny folder lub etykietę (ostatnie 40 wiadomości, tylko do czytania i usuwania).
- **Rozmowy**: wiadomości o tym samym temacie (bez Re:/Fwd:) w jednej skrzynce są powiązane; licznik na liście, sekcja „W tej rozmowie” w wiadomości.
- **Cofnij** po oznaczeniu spamu/oferty/blokady usuwa też regułę nadawcy.
- **Znane ograniczenia**: gwiazdka i flaga „przeczytane” zmienione poza Pocztą nie są jeszcze odświeżane dla już pobranych wiadomości; cofnięcie archiwizacji po wykonaniu jej u dostawcy przywraca tylko widok w aplikacji.

## Kontakty (etap 6)

Zakładka **Kontakty** na dolnym pasku to własna książka adresowa każdej osoby: nazwa + jeden lub kilka adresów + notatka. **Nic nie jest importowane z telefonu** – kontakty powstają tylko tutaj (przycisk +, albo „Dodaj do kontaktów” przy adresie w wiadomości). Pod listą są podpowiedzi „z korespondencji” (osoby, od których dostałeś lub do których pisałeś, a których jeszcze nie ma w kontaktach).

- Na listach i w wiadomości widać Twoją nazwę kontaktu, a pod nią adres.
- W polach Do / Dw / UDW wpisujesz „Mich…”, dostajesz podpowiedzi (kontakty i korespondenci, po nazwie lub adresie), a wybrany kontakt pojawia się jako kafelek z nazwą i adresem.
- Każdy adres (nadawca, odbiorcy, treść tekstowa, oryginał HTML, linki `mailto:`) jest klikalny: napisz, odpowiedz, dodaj/edytuj kontakt, kopiuj, zablokuj nadawcę.
- Powiadomienia push używają nazwy z kontaktów.
- Okna (nowa wiadomość, menu) zamykasz też przeciągnięciem w dół za uchwyt; niezapisana wiadomość pyta o szkic.

## Codzienne udogodnienia (etap 7)

- **Rozmowy zwinięte w jeden wiersz.** Rozmowę tworzą wiadomości powiązane nagłówkami (In-Reply-To / References) albo mające ten sam temat i tę samą drugą stronę w oknie 21 dni. Wiadomość bez tematu, samo „Re:”, newslettery, oferty i spam nie łączą się w rozmowy. Trzy osoby, ten sam temat = trzy rozmowy. Gest przeciągnięcia dotyczy całej rozmowy (z „Cofnij”), a otwarcie rozmowy oznacza ją jako przeczytaną.
- **Wysyłka z cofnięciem i na później.** „Wyślij” kolejkuje wiadomość na 10 s (przycisk „Cofnij” wraca do edycji), zegar obok „Wyślij” planuje wysyłkę na wybraną godzinę. Zaplanowane widać w filtrze „Zaplanowane” (edycja, anulowanie, błędy wysyłki). Kolejka działa po stronie serwera, więc nie trzeba trzymać aplikacji otwartej.
- **Wypisz się** jednym dotknięciem (List-Unsubscribe: jedno kliknięcie, wiadomość mailto albo otwarcie strony). Dotyczy wiadomości odebranych po tej aktualizacji.
- **Bez odpowiedzi.** W zakładce Dziś: wysłane 3–45 dni temu rozmowy, na które nikt nie odpisał, z przyciskiem „Przypomnij się” (nowa wiadomość z cytatem) i „Nie przypominaj”.
- **Szybkie odpowiedzi** („Dziękuję!”, „Potwierdzam.”, …) w oknie odpowiedzi i pod wiadomością.
- **Lokalny zapis wersji roboczej** w telefonie co chwilę podczas pisania. Po zamknięciu aplikacji pojawia się „Niedokończona wiadomość · Przywróć”. To zapis na urządzeniu, a nie szkic w skrzynce (ten robi przycisk „Szkic”).
- **Załączniki:** zakładka Szukaj → Załączniki, lista wszystkich plików z wyszukiwaniem po nazwie, nadawcy i temacie oraz filtrami PDF, Obrazy, Dokumenty.
- **Wyszukiwanie z operatorami:** `od:`, `do:`, `ma:załącznik`, `jest:nieprzeczytane`, `jest:gwiazdka`, `w:wysłane|archiwum|wszystko`, a także zapisane wyszukiwania (inteligentne foldery).
- **Sprawy:** filtry Wydarzenia, Terminy, Paczki.
- **Przypomnienia o terminach płatności** (push): raz, dzień przed i w dniu terminu, od 9:00, poza ciszą nocną.
