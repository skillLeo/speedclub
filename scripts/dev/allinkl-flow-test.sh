#!/bin/bash
# ADR-539: the full ALL-INKL flow on this Mac, from the upload zip, as the owner will do it on the host without SSH or cron:
# fresh folder + fresh database + .env from the shipped .env.example, PHP with symlink() disabled (so the copy fallback runs),
# the web installer, the spent token, the cron URL and its heartbeat, production flags, the demo seeder's refusal, the pages,
# a photo from public/storage, then an update round (new token, maintenance on, setup, maintenance off).
#
#   sh scripts/dev/allinkl-flow-test.sh releases/web/allinkl/speedclub-allinkl-<version>-<stamp>.zip
#
# Uses the local MySQL with the connection of web/.env (copied into the test .env, never printed) and a database
# speedclub_allinkl_flow that is dropped at the end. Tokens are random and never printed. Report: docs/reports/round-5/allinkl-flow/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ZIP="${1:?usage: allinkl-flow-test.sh <speedclub-allinkl-*.zip>}"
[ -f "$ZIP" ] || { echo "no such zip: $ZIP" >&2; exit 1; }
PORT="${PORT:-8123}"
DB=speedclub_allinkl_flow
WORK="$(mktemp -d "${TMPDIR:-/tmp}/speedclub-allinkl-flow.XXXXXX")"
APP="$WORK/speedclub"
BASE="http://127.0.0.1:$PORT"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$ROOT/docs/reports/round-5/allinkl-flow"; mkdir -p "$OUT"
REPORT="$OUT/flow-$STAMP.md"
PASS=0; FAIL=0; SERVER=""

note() { echo "$1" | tee -a "$REPORT"; }
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); note "- PASS $1 ($3)"; else FAIL=$((FAIL + 1)); note "- **FAIL** $1: expected $2, got $3"; fi
}
contains() { # contains <label> <file> <text>
  if grep -qF -- "$3" "$2"; then PASS=$((PASS + 1)); note "- PASS $1"; else FAIL=$((FAIL + 1)); note "- **FAIL** $1: '$3' not found"; fi
}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
dbsql() { (cd "$ROOT/web" && php artisan tinker --execute "DB::statement('$1');" >/dev/null); }
cleanup() {
  # The built-in server forks PHP_CLI_SERVER_WORKERS children: stop the ones of this run (their command line names $WORK).
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null || true
  pkill -f -- "-S 127.0.0.1:$PORT -t . $WORK/" 2>/dev/null || true
  if [ "${KEEP:-0}" = "1" ]; then echo "KEEP=1: work folder $WORK and database $DB kept"; return; fi
  dbsql "DROP DATABASE IF EXISTS $DB" || true
  rm -rf "$WORK"
}
trap cleanup EXIT

note "# ALL-INKL flow test $STAMP"
note ""
note "Package: \`$(basename "$ZIP")\` (SHA-256 $(shasum -a 256 "$ZIP" | cut -c1-16)…). PHP $(php -r 'echo PHP_VERSION;') with symlink(), exec(), proc_open() and the other shell functions disabled, fresh database, APP_ENV=production, tokens random and not printed."
note ""

echo "== unzip into a fresh folder"
unzip -q "$ZIP" -d "$WORK"
check "zip holds no .env" "no" "$([ -e "$APP/.env" ] && echo yes || echo no)"
check "deny-all .htaccess above public/" "yes" "$(grep -q 'Require all denied' "$APP/.htaccess" && echo yes || echo no)"
# Apache applies the deny-all of the folder above to public/ too (go-live 2026-11-24: every URL 403); public/ must grant itself.
check "public/.htaccess grants access under it" "yes" "$(grep -q '^    Require all granted' "$APP/public/.htaccess" && echo yes || echo no)"

echo "== fresh database"
dbsql "DROP DATABASE IF EXISTS $DB"
dbsql "CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

echo "== .env from the shipped .env.example (owner's step H), local values"
SETUP_TOKEN="$(php -r 'echo bin2hex(random_bytes(32));')"
CRON_TOKEN="$(php -r 'echo bin2hex(random_bytes(32));')"
cp "$APP/.env.example" "$APP/.env"
set_env() { # set_env KEY VALUE (replace the line or append it)
  if grep -q "^$1=" "$APP/.env"; then
    KEY="$1" VALUE="$2" php -r '$f=$argv[1]; $k=getenv("KEY"); $v=getenv("VALUE"); file_put_contents($f, preg_replace("/^".preg_quote($k,"/")."=.*$/m", $k."=".addcslashes($v, "\\\\$"), file_get_contents($f)));' "$APP/.env"
  else
    printf '%s=%s\n' "$1" "$2" >> "$APP/.env"
  fi
}
for key in DB_CONNECTION DB_HOST DB_PORT DB_SOCKET DB_USERNAME DB_PASSWORD; do
  line="$(grep -E "^$key=" "$ROOT/web/.env" | head -1 || true)"
  [ -n "$line" ] && set_env "$key" "${line#*=}"
done
set_env DB_DATABASE "$DB"
set_env APP_ENV production
set_env APP_DEBUG false
set_env APP_URL "$BASE"
set_env APP_KEY ""
set_env FORCE_HTTPS false
set_env TRUSTED_HOSTS ""
set_env MAIL_MAILER log
set_env SCHEDULER_INLINE true
set_env CRON_TOKEN "$CRON_TOKEN"
set_env SETUP_TOKEN "$SETUP_TOKEN"
set_env STAFF_OWNER_EMAIL "owner@example.test"
set_env SESSION_SECURE_COOKIE false
chmod 600 "$APP/.env"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then echo "port $PORT is busy: PORT=<free port> sh $0 …" >&2; exit 1; fi
echo "== serve public/ (symlink and shell functions disabled, 4 workers)"
# Laravel's router file takes the current directory as public/.
pushd "$APP/public" > /dev/null
# Like a locked-down shared host: no symlink(), no shell functions (Laravel's link() would fall back to exec('ln -s')).
PHP_CLI_SERVER_WORKERS=4 php -d disable_functions=symlink,exec,shell_exec,system,passthru,proc_open,popen -S "127.0.0.1:$PORT" -t . \
  "$APP/vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php" > "$WORK/server.log" 2>&1 &
SERVER=$!
popd > /dev/null
for _ in $(seq 1 40); do [ "$(status "$BASE/up")" != "000" ] && break; sleep 0.5; done

note ""
note "## First install"
check "setup page, wrong token" 404 "$(status "$BASE/internal/setup/$(php -r 'echo bin2hex(random_bytes(32));')")"
curl -s "$BASE/internal/setup/$SETUP_TOKEN" > "$WORK/setup-get.html"
contains "setup page shows an empty database" "$WORK/setup-get.html" "Datenbank: leer"
START=$(date +%s)
curl -s -X POST "$BASE/internal/setup/$SETUP_TOKEN" > "$WORK/setup-post.html"
note "- setup run took $(( $(date +%s) - START )) s"
contains "setup finished" "$WORK/setup-post.html" "<h2>Fertig</h2>"
contains "APP_KEY generated into .env" "$WORK/setup-post.html" "APP_KEY: leer"
contains "full seeder on the empty database" "$WORK/setup-post.html" "Erstinstallation"
contains "copy fallback for public/storage" "$WORK/setup-post.html" "public/storage wird ein echter Ordner"
contains "config cached (optimize)" "$WORK/setup-post.html" "php artisan optimize"
contains "doctor: no blockers" "$WORK/setup-post.html" "No blockers"
check "APP_KEY now set in .env" "yes" "$(grep -qE '^APP_KEY=base64:.{40,}' "$APP/.env" && echo yes || echo no)"
check "public/storage is a real folder" "dir" "$([ -d "$APP/public/storage" ] && [ ! -L "$APP/public/storage" ] && echo dir || echo other)"
check "config cache written" "yes" "$([ -f "$APP/bootstrap/cache/config.php" ] && echo yes || echo no)"
check "setup token spent (GET)" 404 "$(status "$BASE/internal/setup/$SETUP_TOKEN")"
check "setup token spent (POST)" 404 "$(status -X POST "$BASE/internal/setup/$SETUP_TOKEN")"
check "maintenance with the spent token" 404 "$(status "$BASE/internal/maintenance/$SETUP_TOKEN/on")"
php -r '$h = file_get_contents($argv[1]); preg_match("#<pre>(.*)</pre>#s", $h, $m); echo html_entity_decode($m[1] ?? "", ENT_QUOTES);' "$WORK/setup-post.html" > "$WORK/setup-log.txt"
note ""
note "Doctor of the setup run:"
note '```'
{ sed -n '/speedclub:doctor/,$p' "$WORK/setup-log.txt" | grep -E 'OK|WARN|BLOCK|blocker|warning' | sed -E 's/ +/ /g' | cut -c1-160 || true; } >> "$REPORT"
note '```'

note ""
note "## Pages"
check "/" 200 "$(status "$BASE/")"
check "/up" 200 "$(status "$BASE/up")"
check "/app/" 200 "$(status "$BASE/app/")"
check "/admin/login" 200 "$(status "$BASE/admin/login")"
check "/impressum" 200 "$(status "$BASE/impressum")"
check "/.env (outside public/)" 404 "$(status "$BASE/.env")"
check "/RELEASES.md (outside public/)" 404 "$(status "$BASE/RELEASES.md")"
printf 'flow-photo' > "$APP/public/storage/flow-test.jpg"
check "a photo in public/storage" 200 "$(status "$BASE/storage/flow-test.jpg")"
check "/storage/ listing" 404 "$(status "$BASE/storage/media/")"

note ""
note "## Scheduler (cron URL, as cron-job.org calls it)"
check "cron URL, wrong token" 404 "$(status "$BASE/internal/cron/$(php -r 'echo bin2hex(random_bytes(32));')")"
check "cron URL" 204 "$(status "$BASE/internal/cron/$CRON_TOKEN")"
sleep 62
check "cron URL a minute later" 204 "$(status "$BASE/internal/cron/$CRON_TOKEN")"
sleep 3
HEART="$( { cd "$APP" && php artisan speedclub:doctor 2>&1 | grep -E 'Cron heartbeat' | sed -E 's/ +/ /g' | cut -c1-120; } || true)"
check "doctor heartbeat after two cron calls" "OK" "$(echo "$HEART" | grep -q '| OK' && echo OK || echo "$HEART")"

note ""
note "## Production data"
FLAGS="$(cd "$APP" && php artisan tinker --execute 'echo App\Models\FeatureFlag::query()->orderBy("key")->get(["key","enabled"])->map(fn($f)=>$f->key."=".($f->enabled?"on":"off"))->implode(" "), PHP_EOL;' 2>/dev/null | tail -1)"
note "Flags after the setup (APP_ENV=production): \`$FLAGS\`"
for want in editorial_samples=off shop=off forum=on auth.email_code=on auth.password_login=on auth.passkeys=off events=off web_push=off wrapped=off; do
  check "flag $want" "$want" "$(echo " $FLAGS " | grep -oE " ${want%%=*}=(on|off) " | tr -d ' ' || echo "${want%%=*}=missing")"
done
check "no demo members" 0 "$(cd "$APP" && php artisan tinker --execute 'echo App\Models\User::query()->count(), PHP_EOL;' 2>/dev/null | tail -1)"
check "one Owner from STAFF_OWNER_EMAIL" 1 "$(cd "$APP" && php artisan tinker --execute 'echo App\Models\Staff::query()->count(), PHP_EOL;' 2>/dev/null | tail -1)"
set +e
(cd "$APP" && php artisan db:seed --class=DemoShowcaseSeeder --force > "$WORK/demo.txt" 2>&1); DEMO=$?
set -e
check "demo seeder refuses in production" "refused" "$([ $DEMO -ne 0 ] && grep -q 'refuses to run' "$WORK/demo.txt" && echo refused || echo "exit $DEMO")"

note ""
note "## Update round (new token, maintenance on, setup)"
SETUP_TOKEN="$(php -r 'echo bin2hex(random_bytes(32));')"
set_env SETUP_TOKEN "$SETUP_TOKEN"
check "new token works although the config is cached" 200 "$(status "$BASE/internal/setup/$SETUP_TOKEN")"
check "maintenance on" 200 "$(status "$BASE/internal/maintenance/$SETUP_TOKEN/on")"
check "site in maintenance" 503 "$(status "$BASE/")"
check "cron URL in maintenance" 503 "$(status "$BASE/internal/cron/$CRON_TOKEN")"
curl -s -X POST "$BASE/internal/setup/$SETUP_TOKEN" > "$WORK/update-post.html"
contains "update setup finished" "$WORK/update-post.html" "<h2>Fertig</h2>"
contains "named seeders only on the update" "$WORK/update-post.html" "db:seed --class=StaffSeeder"
contains "APP_KEY kept" "$WORK/update-post.html" "APP_KEY: vorhanden"
check "site back after the setup" 200 "$(status "$BASE/")"
check "update token spent" 404 "$(status "$BASE/internal/setup/$SETUP_TOKEN")"
check "the photo survived the update" 200 "$(status "$BASE/storage/flow-test.jpg")"

note ""
note "**Result: $PASS passed, $FAIL failed.**"
echo "report: $REPORT"
[ "$FAIL" -eq 0 ]
