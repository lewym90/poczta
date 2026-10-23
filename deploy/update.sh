#!/usr/bin/env bash
# Automatyczna aktualizacja Poczty (uruchamiana przez timer systemd raz na dobę, jako root).
# Pobiera kod z GitHuba; jeśli się zmienił: podmienia server/ i web/, instaluje zależności, restartuje usługę
# i sprawdza zdrowie. Przy porażce wraca do poprzedniej wersji. Dane (APP/data) i konfiguracja nie są ruszane.
set -uo pipefail
REPO="${POCZTA_REPO:-lewym90/poczta}"; BRANCH="${POCZTA_BRANCH:-main}"; APP=/opt/poczta; PORT=8792
LOG=/var/log/poczta-update.log; exec >>"$LOG" 2>&1; echo "== $(date -Is)"
[ -f /etc/poczta.env ] && . /etc/poczta.env
export PATH="$APP/node/bin:$PATH"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
AUTH=(); [ -n "${GH_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GH_TOKEN")
curl -fsSL -m 120 "${AUTH[@]}" "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMP" --strip-components=1 || { echo "pobieranie nieudane"; exit 0; }
NEW="$(cd "$TMP" && tar -c server web package.json package-lock.json 2>/dev/null | sha256sum | cut -c1-40)"
OLD="$(cat "$APP/.version" 2>/dev/null || true)"
[ "$NEW" = "$OLD" ] && { echo "bez zmian ($NEW)"; exit 0; }
AV="$(df -Pm / | awk 'NR==2{print $4}')"; [ "${AV:-0}" -gt 200 ] || { echo "za mało miejsca ($AV MB)"; exit 0; }
echo "aktualizuję $OLD -> $NEW"
rm -rf "$APP.prev"; mkdir -p "$APP.prev"; cp -r "$APP/server" "$APP/web" "$APP/package.json" "$APP.prev/" 2>/dev/null; [ -f "$APP/package-lock.json" ] && cp "$APP/package-lock.json" "$APP.prev/"
[ -d "$APP/node_modules" ] && cp -r "$APP/node_modules" "$APP.prev/node_modules"
rm -rf "$APP/server" "$APP/web"; cp -r "$TMP/server" "$TMP/web" "$TMP/package.json" "$APP/"; cp "$TMP/package-lock.json" "$APP/" 2>/dev/null
( cd "$APP" && npm install --omit=dev --no-audit --no-fund --silent ) || echo "npm install: ostrzeżenie"
chown -R poczta:poczta "$APP/server" "$APP/web" 2>/dev/null
systemctl restart poczta; sleep 3
ok=0; for _ in $(seq 1 20); do curl -fsS -m 3 "http://127.0.0.1:$PORT/zdrowie" >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
if [ $ok = 1 ]; then echo "$NEW" > "$APP/.version"; echo "gotowe"
else
  echo "NIEUDANE – wracam do poprzedniej wersji"
  rm -rf "$APP/server" "$APP/web" "$APP/node_modules"; cp -r "$APP.prev/server" "$APP.prev/web" "$APP/"; cp "$APP.prev/package.json" "$APP/"; [ -d "$APP.prev/node_modules" ] && cp -r "$APP.prev/node_modules" "$APP/node_modules"
  chown -R poczta:poczta "$APP/server" "$APP/web" 2>/dev/null; systemctl restart poczta
fi
