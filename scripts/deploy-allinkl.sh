#!/bin/bash
# SPEED CLUB: the upload package for ALL-INKL (shared hosting without SSH and without cronjobs, ADR-539, docs/DEPLOY_ALLINKL.md).
#
#   sh scripts/deploy-allinkl.sh                         full package: build (package-web.mjs) + ALL-INKL extras + checks
#   sh scripts/deploy-allinkl.sh --from <package.zip>    the same from an existing speedclub-web-*.zip (no rebuild)
#   sh scripts/deploy-allinkl.sh --since <old-allinkl.zip>   also an UPDATE zip: only files new or changed since that package,
#                                                        plus speedclub/UPDATE_DELETED.txt (files that are gone; deleting them is optional)
#
# The build itself is scripts/dev/package-web.mjs: the COMMITTED web/ tree, composer install --no-dev -o, the Vite build, the
# production Expo export into public/app, the storage/ and bootstrap/cache folders, PACKAGE_INFO.txt. No .env, no secrets.
# This script adds, inside the one top-level folder speedclub/ (uploaded to /speedclub/, document root /speedclub/public):
#   - speedclub/.htaccess   "deny all": if the domain ever points at /speedclub instead of /speedclub/public, nothing above
#                           public/ (code, .env, storage) is served
#   - speedclub/.env.example = the production template (.env.production.example), which the owner copies to .env
#   - speedclub/ANLEITUNG-ALLINKL.txt  the short version of docs/DEPLOY_ALLINKL.md
# and fails when the zip holds a .env, a key store, node_modules, a missing build, a missing autoloader or storage folder.
# Output: releases/web/allinkl/speedclub-allinkl-<version>-<stamp>.zip (+ .sha256), and with --since the -update- zip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FROM=""; SINCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$FROM" ]; then
  echo "== build (scripts/dev/package-web.mjs, about 10 minutes)"
  LOG="$(mktemp -t speedclub-package)"
  if ! (cd "$ROOT" && nice -n 15 node scripts/dev/package-web.mjs > "$LOG" 2>&1); then
    tail -30 "$LOG"; echo "package-web.mjs failed (log: $LOG)" >&2; exit 1
  fi
  FROM="$(grep -E '^ZIP +:' "$LOG" | tail -1 | sed -E 's/^ZIP +: //')"
  rm -f "$LOG"
fi
[ -f "$FROM" ] || { echo "package not found: $FROM" >&2; exit 1; }
[ -z "$SINCE" ] || [ -f "$SINCE" ] || { echo "previous package not found: $SINCE" >&2; exit 1; }
case "$(basename "$FROM")" in *-DIRTY.zip) echo "refusing a -DIRTY package (mobile/ had uncommitted changes)" >&2; exit 1 ;; esac

mkdir -p "$ROOT/releases/web/allinkl"
python3 -I - "$FROM" "$ROOT/releases/web/allinkl" "$SINCE" "$ROOT/web/.env.production.example" <<'PY'
import hashlib, os, re, sys, time, zipfile, zlib

src, outdir, since, template = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
TOP = 'speedclub/'

HTACCESS = b"""# SPEED CLUB (ADR-539): the document root is /speedclub/public. Should the domain ever point at /speedclub,
# nothing up here (code, .env, storage) may be served.
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order deny,allow
    Deny from all
</IfModule>
"""

GUIDE = """SPEED CLUB auf ALL-INKL (ohne SSH, ohne Cronjob). Ausfuehrlich: docs/DEPLOY_ALLINKL.md

Erstinstallation
 1. KAS: Datenbank anlegen, Domain-Pfad /speedclub/public, SSL + HTTPS-Weiterleitung.
 2. FileZilla (FTPS): den Inhalt dieses Ordners speedclub/ nach /speedclub/ hochladen (versteckte Dateien anzeigen!).
 3. .env.example nach .env kopieren, Werte eintragen (DB_*, MAIL_*, APP_URL, CRON_TOKEN, SETUP_TOKEN), APP_KEY leer lassen.
 4. Browser: https://joinspeedclub.com/internal/setup/<SETUP_TOKEN>  ->  "Einrichtung starten"  ->  "Fertig".
 5. cron-job.org: https://joinspeedclub.com/internal/cron/<CRON_TOKEN>, jede Minute.

Update
 1. Neuen SETUP_TOKEN in .env schreiben.
 2. https://joinspeedclub.com/internal/maintenance/<SETUP_TOKEN>/on
 3. Den Inhalt des Update-Pakets nach /speedclub/ hochladen (ueberschreiben). /speedclub/.env und /speedclub/storage
    nie loeschen; /speedclub/public/storage nie loeschen.
 4. https://joinspeedclub.com/internal/setup/<SETUP_TOKEN>  ->  "Einrichtung starten" (schaltet den Wartungsmodus aus).
"""

FORBIDDEN = [
    (re.compile(r'(^|/)\.env$'), 'a .env file'),
    (re.compile(r'\.(jks|keystore|p12)$'), 'a key store'),
    (re.compile(r'^(?!speedclub/vendor/).*\.(pem|key)$'), 'a key file outside vendor/ (vendor ships public CA bundles)'),
    # The Expo export keeps its bundled assets under public/app/assets/node_modules/… (served files, not a dependency tree).
    (re.compile(r'^speedclub/(?!public/app/assets/)(.*/)?node_modules/'), 'node_modules'),
    (re.compile(r'^speedclub/storage/(logs|framework/(sessions|views|cache/data))/[^/]+\.(log|php)$'), 'runtime files in storage'),
    (re.compile(r'^speedclub/bootstrap/cache/(config|routes-v7|events)\.php$'), 'a cached config/route/event file'),
]
REQUIRED = [
    'speedclub/artisan', 'speedclub/public/index.php', 'speedclub/public/.htaccess', 'speedclub/vendor/autoload.php',
    'speedclub/vendor/composer/autoload_classmap.php', 'speedclub/public/build/manifest.json', 'speedclub/public/app/index.html',
    'speedclub/PACKAGE_INFO.txt', 'speedclub/RELEASES.md', 'speedclub/composer.lock',
]
REQUIRED_DIRS = ['speedclub/storage/app/public/', 'speedclub/storage/app/private/', 'speedclub/storage/framework/cache/',
                 'speedclub/storage/framework/sessions/', 'speedclub/storage/framework/views/', 'speedclub/storage/logs/',
                 'speedclub/bootstrap/cache/']

zin = zipfile.ZipFile(src)
names = zin.namelist()
problems = [f'{why}: {n}' for n in names for rx, why in FORBIDDEN if rx.search(n)]
problems += [f'missing: {n}' for n in REQUIRED if n not in names]
problems += [f'missing folder: {d}' for d in REQUIRED_DIRS if not any(n.startswith(d) for n in names)]
if any(not n.startswith(TOP) for n in names):
    problems.append('an entry outside speedclub/')
classmap = zin.read('speedclub/vendor/composer/autoload_classmap.php').decode('utf-8', 'replace') if 'speedclub/vendor/composer/autoload_classmap.php' in names else ''
if classmap.count('=>') < 1000:
    problems.append('the autoloader is not optimised (composer install -o)')
if any(n.startswith('speedclub/vendor/') and re.search(r'/(phpunit|pestphp|mockery|fakerphp)/', n) for n in names):
    problems.append('dev dependencies in vendor/ (composer install --no-dev)')
if problems:
    sys.exit('package check failed:\n  ' + '\n  '.join(problems[:20]))

info = zin.read('speedclub/PACKAGE_INFO.txt').decode()
version = (re.search(r'^version: (.+)$', info, re.M) or [None, 'x'])[1].strip()
placeholders = (re.search(r'^legal placeholders: (.+)$', info, re.M) or [None, '?'])[1].strip()
stamp = time.strftime('%Y%m%d-%H%M')
extras = {
    'speedclub/.htaccess': HTACCESS,
    'speedclub/.env.example': open(template, 'rb').read(),
    'speedclub/ANLEITUNG-ALLINKL.txt': GUIDE.encode(),
}

def write(path, entries):
    part = path + '.part'
    with zipfile.ZipFile(part, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zout:
        for name, data, info_src in entries:
            zi = zipfile.ZipInfo(name, date_time=info_src.date_time if info_src else time.localtime()[:6])
            zi.compress_type = zipfile.ZIP_STORED if name.endswith('/') else zipfile.ZIP_DEFLATED
            zi.external_attr = (info_src.external_attr if info_src else (0o644 << 16))
            zout.writestr(zi, data)
    os.replace(part, path)
    digest = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    with open(path + '.sha256', 'w') as fh:
        fh.write(f'{digest}  {os.path.basename(path)}\n')
    return digest

entries = [(n, (extras.pop(n) if n in extras else zin.read(n)), zin.getinfo(n)) for n in names]
entries += [(n, data, None) for n, data in extras.items()]
full = os.path.join(outdir, f'speedclub-allinkl-{version}-{stamp}.zip')
digest = write(full, entries)
print(f'ZIP      : {full}')
print(f'SHA-256  : {digest}')
print(f'files    : {sum(1 for n, _, _ in entries if not n.endswith("/"))}')
print(f'legal    : placeholders {placeholders}' + ('' if placeholders.startswith('none') else '  <- fill docs before a public launch (OA-10)'))

if since:
    old = zipfile.ZipFile(since)
    old_crc = {i.filename: (i.CRC, i.file_size) for i in old.infolist() if not i.filename.endswith('/')}
    # Compared by the content written now (CRC of the data, not of the source entry: .env.example is replaced).
    changed = [(n, d, i) for n, d, i in entries if not n.endswith('/') and old_crc.get(n) != (zlib.crc32(d) & 0xffffffff, len(d))]
    current = {n for n, _, _ in entries}
    gone = sorted(n for n in old_crc if n not in current and not n.startswith('speedclub/storage/'))
    note = ('# Dateien, die es im neuen Paket nicht mehr gibt. Loeschen ist optional (sie stoeren nicht).\n'
            '# Nie loeschen: /speedclub/.env, /speedclub/storage, /speedclub/public/storage.\n' + ''.join(f'{n[len(TOP):]}\n' for n in gone))
    changed.append(('speedclub/UPDATE_DELETED.txt', note.encode(), None))
    update = os.path.join(outdir, f'speedclub-allinkl-update-{version}-{stamp}.zip')
    udigest = write(update, changed)
    print(f'UPDATE   : {update}')
    print(f'SHA-256  : {udigest}')
    print(f'changed  : {len(changed) - 1} files, {len(gone)} gone (UPDATE_DELETED.txt)')
PY
