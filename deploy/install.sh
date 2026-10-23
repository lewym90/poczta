#!/usr/bin/env bash
# Instalacja Poczty na VPS. Uruchom jako root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/poczta/main/deploy/install.sh)
# Wzorzec jak w Typerze, Egidzie i Kalendarzu: osobny użytkownik, osobny katalog /opt/poczta,
# usługa tylko na 127.0.0.1:8792, jedna nowa trasa /etc/caddy/conf.d/poczta.caddy (walidacja + wycofanie).
# Innych aplikacji NIE dotyka. Wymaga: systemd, Caddy z conf.d, Node >= 22 (instalator pobierze własny, jeśli trzeba).
set -uo pipefail
REPO="${POCZTA_REPO:-lewym90/poczta}"; BRANCH="${POCZTA_BRANCH:-main}"
APP=/opt/poczta; USR=poczta; ENVF=/etc/poczta.env; PORT=8792; BASE=/poczta
CF="${CADDYFILE:-/etc/caddy/Caddyfile}"; CD="${CONFD:-$(dirname "$CF")/conf.d}"; ROUTE="$CD/poczta.caddy"
say() { printf '== %s\n' "$*"; }
die() { printf 'PRZERWANO: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "uruchom jako root"
command -v systemctl >/dev/null || die "brak systemd"
command -v caddy >/dev/null || die "nie widzę Caddy"
[ -f "$CF" ] || die "brak $CF"
grep -qF "$CD" "$CF" || die "Caddy nie wczytuje $CD – najpierw uruchom: bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/typer/main/typer/caddy_confd.sh)"
SITE_LINE="$(grep -nE '^[^[:space:]{#(][^{]*\{[[:space:]]*$' "$CF" | head -n1 | cut -d: -f1)"
DOM="$(sed -n "${SITE_LINE}p" "$CF" | sed -E 's/[[:space:]]*\{.*$//; s/[[:space:]].*$//')"
[ -n "$DOM" ] || die "nie ustaliłem domeny z Caddyfile"
health() { [ -n "${SKIP_HEALTH:-}" ] && return 0; curl -fsS -m 10 "https://$DOM/zdrowie" >/dev/null 2>&1; }
HB=0; health && HB=1

# 0) Miejsce na dysku (VPS ma mało): potrzeba ok. 150 MB
AV="$(df -Pm / | awk 'NR==2{print $4}')"; [ "${AV:-0}" -gt 300 ] || die "za mało miejsca na dysku (${AV:-?} MB wolnych). Zwolnij miejsce lub powiększ dysk."

# 1) Użytkownik i katalogi
id "$USR" >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin "$USR" || die "useradd"
mkdir -p "$APP/data" "$APP/node"

# 2) Node 22+ (własna kopia, jeśli systemowy za stary)
NODE="$(command -v node || true)"
if [ -z "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
  say "Pobieram własny Node 22 do $APP/node"
  case "$(uname -m)" in x86_64) A=x64;; aarch64|arm64) A=arm64;; *) die "nieobsługiwana architektura";; esac
  B=https://nodejs.org/dist/latest-v22.x
  F="$(curl -fsSL $B/SHASUMS256.txt | grep -o "node-v[0-9.]*-linux-$A.tar.xz" | head -n1)" || die "nie znalazłem Node"
  curl -fsSL "$B/$F" | tar -xJ -C "$APP/node" --strip-components=1 || die "pobieranie Node"
  NODE="$APP/node/bin/node"
fi
export PATH="$(dirname "$NODE"):$PATH"
say "Node: $($NODE -v)"

# 3) Kod aplikacji z GitHuba (repo publiczne; dla prywatnego ustaw GH_TOKEN)
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
AUTH=(); [ -n "${GH_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GH_TOKEN")
curl -fsSL "${AUTH[@]}" "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMP" --strip-components=1 || die "pobieranie kodu z GitHuba ($REPO)"
rm -rf "$APP/server" "$APP/web"; cp -r "$TMP/server" "$TMP/web" "$TMP/package.json" "$TMP/package-lock.json" "$APP/" 2>/dev/null || cp -r "$TMP/server" "$TMP/web" "$TMP/package.json" "$APP/"
( cd "$APP" && npm install --omit=dev --no-audit --no-fund --silent ) || die "npm install"

# 4) Konfiguracja i kod instalacji (zachowane przy ponownym uruchomieniu)
if [ ! -f "$ENVF" ]; then
  CODE="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)"
  KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  ( umask 077
  { echo "NODE_ENV=production"; echo "TZ=Europe/Warsaw"; echo "POCZTA_PORT=$PORT"; echo "POCZTA_HOST=127.0.0.1"; echo "POCZTA_BASE=$BASE"
    echo "POCZTA_DATA=$APP/data"; echo "POCZTA_SECRET_KEY=$KEY"; echo "POCZTA_SETUP_CODE=$CODE"; echo "POCZTA_MAX_USERS=1"; echo "POCZTA_DEMO=0"
    echo "KALENDARZ_URL=https://lewym90.github.io/kalendarz/"; } > "$ENVF" )
fi
chmod 600 "$ENVF"
chown -R "$USR":"$USR" "$APP/data"
say "UWAGA: skopiuj kopię zapasową $ENVF (zawiera klucz szyfrowania haseł skrzynek). Bez niego zapisane hasła są nie do odczytania."

# 5) Usługa systemd (limit pamięci, bo VPS ma < 1 GB RAM)
cat > /etc/systemd/system/poczta.service <<U
[Unit]
Description=Poczta – klient poczty
After=network-online.target
Wants=network-online.target
[Service]
User=$USR
EnvironmentFile=$ENVF
WorkingDirectory=$APP
ExecStart=$NODE --no-warnings $APP/server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP/data
MemoryMax=220M
[Install]
WantedBy=multi-user.target
U
chmod 644 /etc/systemd/system/poczta.service
systemctl daemon-reload && systemctl enable --now poczta >/dev/null 2>&1
systemctl restart poczta; sleep 2
systemctl is-active --quiet poczta || { journalctl -u poczta -n 20 --no-pager >&2; die "usługa nie wystartowała (Caddy i inne aplikacje nietknięte)"; }
curl -fsS -m 5 "http://127.0.0.1:$PORT/zdrowie" >/dev/null || die "usługa nie odpowiada lokalnie"

# 6) Trasa w Caddy (z walidacją i wycofaniem)
mkdir -p "$CD"
[ -f "$ROUTE" ] && cp -p "$ROUTE" "$ROUTE.bak"
cat > "$ROUTE" <<R
redir $BASE $BASE/ permanent
handle_path $BASE/* {
	reverse_proxy 127.0.0.1:$PORT
}
R
chmod 755 "$CD"; chmod 644 "$ROUTE"
rollback() { say "WYCOFUJĘ trasę"; if [ -f "$ROUTE.bak" ]; then mv -f "$ROUTE.bak" "$ROUTE"; else rm -f "$ROUTE"; fi; systemctl reload caddy 2>/dev/null || systemctl restart caddy; exit 1; }
caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 || { echo "Caddy odrzucił konfigurację." >&2; rollback; }
systemctl reload caddy || rollback
sleep 3
systemctl is-active --quiet caddy || rollback
if [ $HB = 1 ]; then ok=0; for _ in 1 2 3 4 5 6; do health && { ok=1; break; }; sleep 3; done; [ $ok = 1 ] || { echo "Typer nie odpowiada po zmianie." >&2; rollback; }; fi
rm -f "$ROUTE.bak"
OKR=0; for _ in 1 2 3 4 5; do curl -fsS -m 10 "https://$DOM$BASE/zdrowie" >/dev/null 2>&1 && { OKR=1; break; }; sleep 3; done
. "$ENVF"
say "GOTOWE. Inne aplikacje działają jak wcześniej.$([ $OKR = 1 ] || echo ' (UWAGA: trasa publiczna jeszcze nie odpowiada – odczekaj chwilę i sprawdź ponownie)')"
echo
echo "Otwórz na iPhonie w Safari:  https://$DOM$BASE/"
echo "Kod instalacji (do założenia konta właściciela): $POCZTA_SETUP_CODE"
echo "Potem: Udostępnij → Do ekranu początkowego."
