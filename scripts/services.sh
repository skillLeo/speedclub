#!/usr/bin/env bash
# SPEED CLUB - local services on macOS and Linux (ADR-102, ADR-157). The Unix twin of scripts/services.ps1.
#
#   scripts/services.sh start   : PHP-FPM on 127.0.0.1:9085 and a dedicated Apache on http://localhost:8080 -> web/public
#   scripts/services.sh stop    : stops both (by pid file; nothing else on the machine is touched)
#   scripts/services.sh status  : ports 3306, 9085, 8080 and GET /up
#
# MySQL is not started or stopped here: it is shared with other projects on this machine. Start it with its own
# service manager (for example `brew services start mysql`) if it is not listening on 3306.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/web/storage/logs"
HTTPD_PREFIX="${SC_HTTPD_PREFIX:-$(brew --prefix httpd 2>/dev/null || echo /usr)}"
HTTPD="$HTTPD_PREFIX/bin/httpd"
MIME_TYPES="${SC_MIME_TYPES:-$(brew --prefix 2>/dev/null || echo /usr/local)/etc/httpd/mime.types}"
PHP_FPM="${SC_PHP_FPM:-$(command -v php-fpm || echo "$(brew --prefix php 2>/dev/null)/sbin/php-fpm")}"
APACHE_PID="$LOGS/apache-8080.pid"
FPM_PID="$LOGS/php-fpm-9085.pid"

listening() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }

wait_port() {
  local port="$1" tries=0
  until listening "$port"; do
    tries=$((tries + 1))
    [ "$tries" -gt 60 ] && return 1
    sleep 0.5
  done
}

stop_pid() {
  local file="$1" label="$2"
  if [ ! -f "$file" ]; then echo "[--]   $label not running (no pid file)"; return; fi
  local pid; pid="$(tr -d '[:space:]' < "$file")"
  if [ -n "$pid" ] && kill "$pid" 2>/dev/null; then echo "[ok]   stopped $label (pid $pid)"; fi
  rm -f "$file"
}

start_fpm() {
  if listening 9085; then echo "[ok]   PHP-FPM already listening on 127.0.0.1:9085"; return; fi
  [ -x "$PHP_FPM" ] || { echo "[FAIL] php-fpm not found ($PHP_FPM)"; exit 1; }
  mkdir -p "$LOGS"
  SC_ROOT="$ROOT" "$PHP_FPM" --fpm-config "$ROOT/scripts/dev/php-fpm-speedclub.conf" || { echo "[FAIL] php-fpm did not start, see $LOGS/php-fpm-error.log"; exit 1; }
  if wait_port 9085; then echo "[ok]   PHP-FPM on 127.0.0.1:9085"; else echo "[FAIL] php-fpm did not listen on 9085"; exit 1; fi
}

start_apache() {
  if listening 8080; then echo "[ok]   :8080 already listening"; return; fi
  [ -x "$HTTPD" ] || { echo "[FAIL] httpd not found ($HTTPD); on macOS: brew install httpd"; exit 1; }
  mkdir -p "$LOGS"
  "$HTTPD" -d "$HTTPD_PREFIX" -C "Define SC_ROOT $ROOT" -C "Define SC_MIME_TYPES $MIME_TYPES" -f "$ROOT/scripts/dev/httpd-speedclub-unix.conf" -k start \
    || { echo "[FAIL] Apache did not start, see $LOGS/apache-error.log"; exit 1; }
  if wait_port 8080; then echo "[ok]   Apache on http://localhost:8080"; else echo "[FAIL] Apache did not listen on 8080"; exit 1; fi
}

status() {
  for port in 3306 9085 8080; do
    if listening "$port"; then printf ':%-5s listening\n' "$port"; else printf ':%-5s down\n' "$port"; fi
  done
  printf '/up   HTTP %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8080/up)"
}

case "${1:-status}" in
  start)
    listening 3306 && echo "[ok]   MySQL listening on :3306" || echo "[warn] nothing listens on :3306; start the database with its own service manager"
    start_fpm
    start_apache
    ;;
  stop)
    stop_pid "$APACHE_PID" 'Apache :8080'
    stop_pid "$FPM_PID" 'PHP-FPM :9085'
    ;;
  status) status ;;
  *) echo "usage: scripts/services.sh start|stop|status"; exit 2 ;;
esac
