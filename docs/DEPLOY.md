# SPEED CLUB — Deploy to shared hosting

> **Phase 3 version (M3.9, 2026-11-09).** Source of truth for the design: `docs/05_ARCHITECTURE.md` §19–§20; rulings: ADR-126, 130, 167, 214–244 (`docs/DECISIONS.md`); security input: `docs/reports/security/phase-1.md` §4, `phase-2.md` (SEC-P2-14), Phase 3 round 1 (SEC-P3-05).
> **What changed against the Phase 2 text:** the staff area is real now (sign-in, mandatory TOTP, four-eyes, IP allow-list enforced), so the Phase 1 rule "no staff on staging, `/admin` closed at the host" is replaced by the staff rules of 7 and checklist item 1. New: every `.env` key of Phase 3 (3), the full scheduler table (5), backups with a restore test (12), the first update to Phase 3 (11), the dry run procedure of M3.10 (13).
> **Verified so far:** the Phase 1 and Phase 2 packages were dry-run locally (notes at the end). The Phase 3 package `speedclub-web-1.0.0-20261110-0527.zip` (commit `e8f9d3f`) passed the dry run of 13 on the Mac on 2026-11-10 (first deploy, update from 0.2.0, backup and restore; notes below 13). Corrections from that run are in 9, 11, 12 and 13. Nothing has run on a real host yet. iOS and TestFlight: `docs/IOS_TESTFLIGHT.md`.

The package is one zip, built on the dev machine, with `vendor/` (production only, optimised autoloader), the built admin and public assets (`public/build`), the member web app (`public/app`) and the release register (`RELEASES.md`). The server needs **no Composer, no Node and no build step**.

## 0. What you need

| Item | Requirement |
|---|---|
| PHP | 8.3 or newer (8.4 preferred), CLI and web on the same version |
| PHP extensions | ctype, curl, dom, exif, fileinfo, filter, gd (**WebP and FreeType**), intl, mbstring, openssl, pdo_mysql, session, sodium, tokenizer, xml, zip |
| PHP limits | `memory_limit` ≥ 256M, `upload_max_filesize` ≥ 20M, `post_max_size` ≥ 25M, `max_execution_time` ≥ 60. The 512 KB limit on JSON bodies depends on this `memory_limit`: the worst body peaks at about 194 MB, and below 256M it can answer an empty 500 (ADR-179) |
| PHP functions | `proc_open` (scheduler and backups), `symlink` (storage link, see 6), `fastcgi_finish_request` or `litespeed_finish_request` on the **web** PHP (ADR-130: sign-in codes are mailed after the response) |
| Database | MySQL 8 or MariaDB ≥ 10.6, one empty database with its own user; `mysqldump` on the server for backups (12) |
| Access | **SSH and cron** (a host without both cannot run the scheduler: choose another) |
| Network | HTTPS certificate for the domain (and for `ADMIN_DOMAIN`, if used); outbound HTTPS (Pusher, Expo, AI provider) and SMTP allowed |
| Domain | for example `staging.<domain>` or the live domain; the document root must be settable to `public/` |
| Staff network | a **fixed IP address or range** for the people who use `/admin` (office, VPN): the admin allow-list (7) needs it |

`php artisan speedclub:doctor` (step 9) checks most of this and tells you what is missing.

## 1. Build the package (dev machine)

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-web.ps1
# or, without PowerShell: node scripts/dev/package-web.mjs
```

Output: `releases/web/speedclub-web-<versionName>-<yyyyMMdd-HHmm>.zip` plus `.sha256`. It contains one folder, `speedclub/`, with `PACKAGE_INFO.txt` and `RELEASES.md` at its top (above `public/`, so not reachable from the web). It does **not** contain `.env*` (only `.env.example` and `.env.production.example`), `node_modules` (except `public/app/assets/node_modules`: the fonts and icons of the Expo export, which the app loads at runtime), `tests`, e2e specs, logs, caches or `public/storage`, and outside `vendor/` no phpunit/pest files.

Where the parts come from (commit first):
- **Laravel (`web/`)**: the **committed** tree (`git archive HEAD web`). Uncommitted changes in `web/` are not in the package; the script says so. The script **stops** when `.gitignore` hides a file inside a source folder of `web/` (`app`, `bootstrap`, `config`, `database`, `lang`, `public`, `resources`, `routes`; this once hid the release register service and the admin sign-in strings, e7f9dfb), and when the committed tree lacks a Phase 3 part: `routes/admin.php`, `routes/admin/*.php`, `lang/admin/de` and `lang/admin/en` with the same files, the release register service.
- **Built assets (`public/build`)**: `npm ci` on the committed lock file inside the stage folder, then `vite build`. The script fails when the Vite manifest has a key outside `web/`, lacks the font keys of `font-preload.blade.php`, or lacks one of the four entries (admin app + CSS, public app + CSS): each of these would make pages answer 500.
- **Member web app (`public/app`)**: always a fresh Expo export with `EXPO_PUBLIC_APP_ENV=production` and no other `EXPO_PUBLIC_*` value, written straight into the stage folder (never the `web/public/app` of the dev server). It is exported from the **working copy** of `mobile/`, so the script **stops when `mobile/` has uncommitted changes**; `-AllowDirty` (`--allow-dirty`) builds anyway, named `…-DIRTY.zip`, for a throwaway package only. It also fails when `index.html` still holds the `qa:start` block, any JS file contains `qaTheme`, a built file would be left out of the zip, or the bundle names an asset the zip does not hold.
- **Release register (`RELEASES.md`)**: `docs/RELEASES.md` of the same commit, for `speedclub:releases-sync` (ADM-38, step 4).

Never deploy a package named `…-DIRTY.zip`, or one whose `PACKAGE_INFO.txt` says `mobile: DIRTY` (`unzip -p speedclub-web-….zip speedclub/PACKAGE_INFO.txt`). `PACKAGE_INFO.txt` also lists legal texts that still hold `[[…]]` placeholders (7).

Check the download on the server before unzipping: `sha256sum speedclub-web-….zip` must equal the `.sha256` file.

## 2. Upload and unzip — outside the public folder

1. Upload the zip **above** the web root, for example to `/home/<user>/` (not into `public_html`).
2. `unzip speedclub-web-….zip` there. Result: `/home/<user>/speedclub/` with `app`, `public`, `storage`, `vendor` and so on.
3. Point the **document root of the (sub)domain to `/home/<user>/speedclub/public`** in the host panel. Nothing but `public/` may be reachable from the web: `.env`, `storage`, `vendor` and `RELEASES.md` live one level above. With `ADMIN_DOMAIN`, point that host to the same `public/`.
   - If the panel only allows a fixed `public_html`: replace it with a symlink (`ln -s ~/speedclub/public ~/public_html`) after moving the old folder away, or ask support to change the docroot. Do not copy `public/` into `public_html`: `public/index.php` expects `../vendor` and `../bootstrap`.
4. Make these writable for the PHP user (usually already the case; `speedclub:doctor` reports them): `storage` (recursively), `bootstrap/cache`.
5. Use the PHP version of step 0 for both web and SSH. On many hosts the CLI is `php8.4` or `/usr/local/bin/php8.4`; use that binary everywhere below and in the cron entry.

## 3. Create `.env`

```
cd ~/speedclub
cp .env.production.example .env
chmod 600 .env
```

`.env.production.example` lists **every key the app reads in production**, each with a comment. Fill in:

**Always**
- `APP_ENV=staging` for the client test host (search engines kept out: `ALLOW_INDEXING` defaults to false there; `/docs/api` open, see checklist 2) or `production` for the live site. `APP_DEBUG=false`. `APP_URL=https://<your domain>`. `APP_KEY` stays empty until step 4.
- `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` of the empty database.
- `SANCTUM_STATEFUL_DOMAINS` (bare host, e.g. `speedclub.de`) and `CORS_ALLOWED_ORIGINS` (origin, e.g. `https://speedclub.de`) for your domain, plus the `www.` variant if you serve it. Keep `SESSION_SECURE_COOKIE=true`, `SESSION_ENCRYPT=true`, `SESSION_DOMAIN` empty.
- `TRUSTED_HOSTS`: extra host names (for example the `www.` variant); `ADMIN_DOMAIN` is added automatically.
- `TRUSTED_PROXIES`: only if the host puts a TLS proxy in front, its IPs or CIDR ranges. **Never `*` together with `ADMIN_IP_ALLOWLIST`** (ADR-231): the allow-list then ignores forwarded headers, sees only the proxy's address and refuses your staff (or, behind a proxy on your own network, lets everybody behind it in); the log says `ADMIN_IP_ALLOWLIST is set with TRUSTED_PROXIES=*`. Ask the host for the proxy ranges.
- `FORCE_HTTPS`: see 8.
- `MAIL_*` (10), `SUPPORT_EMAIL` and `MODERATION_EMAIL` (both commented out = defaults; uncomment with real addresses: the moderation mailbox receives DSA notices), `MEDIA_DISK=public`.
- **Staff (7):** `ADMIN_IP_ALLOWLIST` = your fixed staff addresses or ranges; `STAFF_OWNER_EMAIL` = the address of the first Owner (a real mailbox the Owner reads); `ADMIN_DOMAIN` only if you want a separate admin host. `DEMO_STAFF_PASSWORD`, `DEMO_MEMBER_PASSWORD` empty, `DEMO_SEED_ON_STAGING=false`.
- `ANDROID_PACKAGE=de.speedclub.app` and `ANDROID_CERT_SHA256` (App Links): the current upload key, created on the Mac on 2026-11-07, is `95:EF:80:0D:F2:D5:D9:2B:0F:8C:A9:C9:DE:D0:B7:1B:F9:6B:0B:82:38:92:84:B2:1E:8E:24:86:30:02:F0:79`. Once the app is on Google Play, add Play's app-signing certificate, comma separated (Play Console → App integrity).
- `IOS_TEAM_ID` (and `IOS_BUNDLE_ID=de.speedclub.app`) once the Apple Developer account exists (OA-15).
- `HEALTH_TO_ADDRESS`: who gets the health mails (cron stopped, queue stuck, disk full). `HOME_CLOCK` stays **empty** on every host.
- `BACKUP_ARCHIVE_PASSWORD`: a long random password for the backup zips (12); keep a copy in the password manager.

**Optional services** (each switches itself off when its keys are empty):

| Key | Set to | Without it |
|---|---|---|
| `PUSHER_APP_ID`, `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, `PUSHER_APP_CLUSTER=eu`, `BROADCAST_CONNECTION=pusher` | the Pusher Channels app (EU), OA-13; see 10 | the apps poll (3 s in a conversation, 15 s in the inbox) |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | `true` once the Expo project and its FCM V1 / APNs keys exist (OA-14); the token with "enhanced push security" on (10, **recommended for production**, SEC-P2-14) | no push; in-app notifications, tab badges and e-mail still work |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY` (or the key of another provider); optional `AI_MODEL`, `AI_TIMEOUT`, `AI_DAILY_*` | both set (OA-18); then switch the features on in the admin (10) | every AI endpoint answers 404 `feature_disabled`, no `ai.*` flag can be switched on; the app hides the AI entries |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | a Cloudflare Turnstile widget for the domain; protects `/melden`, `/kontakt`, `/konto-loeschen` | the forms work without a challenge, protected by their rate limits only. Recommended on any public host |
| `DISPUTE_SETTLEMENT_URL` | the Art. 21 DSA body (lawyer to confirm, OA-17) | the European Commission's page on out-of-court dispute settlement |
| `STORE_URL_IOS`, `STORE_URL_ANDROID` | the store listings, once published | no store badges |
| `FEATURED_VEHICLE_SLUG`, `HOME_FEATURED_SLUGS` | slugs of builds to feature | the most complete public builds (the admin's curation, ADM-29, wins once used) |
| `TESTER_APK_URL`, `TESTER_APK_SHA256` | staging only: the HTTPS link of the tester APK and its SHA-256 (the `.sha256` file of `build-apk.ps1`) | `/app-laden` shows no download. **Empty in production** |
| `SENTRY_LARAVEL_DSN` | an EU Sentry project, if wanted (name it in the privacy policy first) | errors only in `storage/logs` |
| `MEDIA_DISK=s3` + `AWS_*` | an S3-compatible EU bucket (6) | photos in `storage/app/public` |

New in Phase 3 against a Phase 2 `.env`: `ADMIN_IP_ALLOWLIST` (now enforced), `STAFF_OWNER_EMAIL` (now set), `ADMIN_DOMAIN` (optional), `AI_*` (optional), `BACKUP_ARCHIVE_PASSWORD`, `AUTH_PASSWORD_TIMEOUT=300` (already in the Phase 2 example; keep it), `HEALTH_TO_ADDRESS`.

Do not put the `.env` content into any chat or ticket. After every later `.env` change: `php artisan config:cache`.

## 4. First deploy: commands

**Before the first seed on a host anyone else will see:** the legal texts must carry the real details (7, OA-10). `PACKAGE_INFO.txt` must say `legal placeholders: none`.

Run from `~/speedclub` over SSH, in this order:

```
php artisan key:generate --force      # first deploy only; needs the line "APP_KEY=" in .env
php artisan down
php artisan migrate --force
php artisan db:seed --force           # first deploy only (7); prints the Owner line
php artisan storage:link              # fallback: see 6
php artisan speedclub:releases-sync --path=RELEASES.md    # ADM-38 release register; idempotent
php artisan optimize
# staging only: insert the /docs rule of checklist item 2 into public/.htaccess
php artisan up
php artisan speedclub:doctor          # 9
```

Never run `key:generate` again on a live site: it signs out everyone, breaks the signed chat-photo URLs and every encrypted column (sessions, TOTP secrets, AI translation cache).

Then the cron entry (5) and the first Owner (7).

## 5. Cron and the queue

One cron entry, every minute (host panel "Cron jobs", or `crontab -e`):

```
* * * * * cd /home/<user>/speedclub && /usr/local/bin/php8.4 artisan schedule:run >> /dev/null 2>&1
```

**Host without `proc_open`** (the doctor says "proc_open … Disabled"; Hostinger's shared plans and many others disable it, with `exec` and `symlink`): `schedule:run` cannot start its commands there. Use this cron entry instead, and set `SCHEDULER_INLINE=true` in `.env` (then `php artisan config:cache`):

```
* * * * * cd /home/<user>/speedclub && /usr/bin/php artisan speedclub:schedule-inline >> /dev/null 2>&1
```

It runs the same due tasks, time zones, maintenance rule and overlap locks one after the other in its own PHP process, the queue worker last. Because that process is shared, the worker gets its usual 128 MB memory budget on top of what the earlier tasks of the minute already use (it would otherwise stop at once with exit code 12 after a heavy task). The app's own backups need `proc_open` for the database dump, so they stay off there; the host's daily backups apply (12). On Hostinger the cron entry is made in hPanel → Advanced → Cron Jobs (there is no `crontab` over SSH), and a missing PHP extension such as `sodium` is switched on with `selectorctl --enable-user-extensions=sodium --version=8.3` or in hPanel → PHP Configuration.

The scheduler (`routes/console.php`) is everything. **There is no separate queue daemon:** the last scheduled entry runs `queue:work --stop-when-empty --max-time=50 --tries=3` every minute (without overlapping, lock expires after 2 minutes), with the queue in the database (`QUEUE_CONNECTION=database`). Mail (except sign-in codes, ADR-130), push and the search projection therefore lag by up to one minute. If the host kills long PHP processes, lower the 50 s worker limit in `routes/console.php` (a code change, not an `.env` setting).

What the scheduler runs (times UTC unless Europe/Berlin is named; nothing to configure, listed so that you recognise them in logs and in the admin's system page):

| When | Command | What |
|---|---|---|
| every minute | `health:schedule-check-heartbeat`, `health:queue-check-heartbeat`, then (last) `queue:work` | the cron heartbeat the doctor and the health checks read; the queue |
| every 5 minutes | `health:check` | health checks; failures mail `HEALTH_TO_ADDRESS` |
| every 15 minutes | `CheckPushReceiptsCommand`, `LiftExpiredSuspensionsCommand` | push receipts from Expo; timed suspensions and restrictions end |
| hourly | `PrunePlatformDataCommand`, `sanctum:prune-expired --hours=24`, `RankHomeFeedCommand` (no overlap), `PruneDataExportsCommand`, `approvals:expire` | platform data; expired tokens; Home ranking; export files after 7 days; four-eyes requests end after 24 h (ADR-214) |
| daily 00:00 | `PruneMediaCommand`, `PruneVehiclesCommand`, `PruneCatalogImports` (job), `model:prune` (health history) | deleted media and vehicles after 30 days; catalogue import files after 30 days, stalled imports restarted |
| daily 00:05 Europe/Berlin | `speedclub:kpi-snapshot` | the WAU tile of the admin dashboard (ADR-220) |
| daily 02:00 | `AuditExportCommand`, `AuditVerifyCommand` | audit log export and hash-chain verification |
| daily 02:30 | `AuditRetentionCommand` | audit rows past 24 months go to the archived export |
| daily 03:00 / 03:15 / 03:30 | `PruneOgImagesCommand`, `PruneNotificationsCommand`, `GenerateSitemapCommand` | OG cards, old notifications, `sitemap.xml` |
| daily 04:00 / 04:10 | `PruneDeletedAccountsCommand`, `PruneSupportTicketsCommand` | accounts hard-deleted within 30 days of the request; support tickets after the retention period |
| daily 04:20 / 04:30 / 04:40 | `PrunePrivacyRequestsCommand`, `PruneModerationCasesCommand`, `ai:prune` | GDPR request files (ADM-45); moderation cases after 36 months unless open or appealed (ADR-239); AI call logs after 90 days (ADR-242) |
| daily 09:00 Europe/Berlin | `SendQrMilestonesCommand`, `SendHuAuRemindersCommand` | QR milestones and HU/AU reminders (each stops after 40 s) |
| daily 18:00 Europe/Berlin | `SendMessageDigestCommand` | opt-in e-mail digest of unread messages |
| Monday 09:00 Europe/Berlin | `SendSavedBuildsDigestCommand` | saved-builds digest |

Retention periods come from the published config key `retention` (admin, ADM-47/ADR-239) within the bounds the privacy policy promises.

What runs **on the queue**: uploaded photo processing (vehicle, avatar, chat photos), push sends, decision and support mails, digest slices, the data export (the zip goes to the private disk), notifying followers, the search projection rebuild, catalogue merge relinking (35 s slices, ADR-234) and approved bulk actions (ADR-229). Realtime messaging events are **not** queued: they go to Pusher during the request. Scheduled events run one after another inside `schedule:run`, so in the minutes with several daily jobs the worker starts later than usual; nothing is lost.

**Backups are scheduled** (12, ADR-250): `backup:clean` and `backup:run` daily at 01:30, `backup:monitor` daily at 07:00, through the same `schedule:run` cron.

## 6. Storage link (media)

`php artisan storage:link` creates `public/storage` → `storage/app/public`. Uploaded photos, OG cards and brand assets are served from there.

If it fails ("symlink() has been disabled"), in this order:
1. Create the link in the SSH shell yourself: `cd ~/speedclub/public && ln -s ../storage/app/public storage`.
2. Ask the host to allow `symlink()` for the account, or to create that one link.
3. Use an S3-compatible EU bucket: `MEDIA_DISK=s3` and the `AWS_*` keys in `.env`, then `php artisan config:cache`.

**Private disk.** Chat photos, data-export zips, photo originals, report evidence, catalogue imports, GDPR request files and the audit exports live on the `local` disk, `storage/app/private` (`MEDIA_PRIVATE_DISK=local`). It has **no** web route and must never be linked or copied below `public/`: chat photos reach members only through signed URLs that depend on `APP_KEY`. Keep it on the server's own disk even with `MEDIA_DISK=s3`, back it up (12), and keep `storage/` writable. An update must leave it in place (11).

`speedclub:doctor` shows "Storage link" and "Directory listing" (`/storage/media/` must not answer an "Index of"; `public/.htaccess` sets `Options -Indexes`).

## 7. Seeding and staff accounts

### Seeding (first deploy only)

`php artisan db:seed --force` runs `DatabaseSeeder`:

| Seeder | Gives you |
|---|---|
| `CatalogSeeder`, `ModCategorySeeder`, `BrandSeeder` | makes/models catalogue, modification categories and fields, part brands |
| `LegalDocumentSeeder` | Impressum, Datenschutz, AGB, Community-Richtlinien and Lizenzen (DE + EN) from `database/data/legal/*.md` |
| `HelpArticleSeeder`, `CollectionSeeder` | help articles (SET-14), Discover collections |
| `FeatureFlagSeeder`, `ConfigSeeder` | feature flags (all `ai.*` off) and runtime config defaults (rate limits, retention, org, branding) |
| `StaffSeeder` | the staff roles and permission atoms of `06` §2, and the Owner account of `STAFF_OWNER_EMAIL` |

**Run the full `db:seed` only on an empty database.** On an existing host `CatalogSeeder` would bring back catalogue entries the team deleted in the admin (ADR-234). Updates run named seeders only (11).

**Legal texts.** `LegalDocumentSeeder` creates version 1 of each text once and never overwrites it. Since M3.5 the texts can be edited and published in the admin (ADM-31, publishing AGB/Datenschutz with re-consent is four-eyes), and the org settings (ADM-52, Owner only) fill the `[[Firmenname]]`-style placeholders when a text is shown. Still, a public host should start from reviewed texts: fill in `web/database/data/legal/` (ten files), have them checked (docs/08, OA-10, OA-17), commit, build the package, and check that this prints `0`:

```
unzip -p speedclub-web-….zip 'speedclub/database/data/legal/*.md' | grep -c '\[\['
```

`DemoSeeder` (demo members and builds) needs `fakerphp/faker`, a dev dependency that is **not** in this package. A host from this package starts without demo content; the client creates their own account and builds.

### The first Owner (staff onboarding)

Staff and members are fully separate: different table, guard, cookie (`/admin` path only) and password reset. Every staff account needs a password it set itself (ADR-218) and **TOTP** before it can do anything.

1. Before the first seed: `STAFF_OWNER_EMAIL=<owner's mailbox>` and `ADMIN_IP_ALLOWLIST=<your fixed addresses>` in `.env`, `php artisan config:cache`. Mail must work (10).
2. `php artisan db:seed --force` prints `Owner account ready. Set its password through the staff password reset.` The account has a random password nobody knows and `password_proof_required`: it cannot sign in before step 4.
3. From an allow-listed address open `https://<domain>/admin/login` (or `https://<ADMIN_DOMAIN>/admin/login`) → **"Passwort vergessen?"** → enter the Owner address. The mail contains a link `…/admin/reset#token=…`, valid **60 minutes**, once.
4. Open the link, set a strong password (the common-password list applies).
5. Sign in. The admin sends every account without TOTP to **two-factor setup** (ADM-03): scan the QR code with an authenticator app (1Password, Bitwarden, Google/Microsoft Authenticator…), enter a code, **store the recovery codes** in the password manager. Only then does the dashboard open.
6. Invite the team in **Team** (ADM-39): each invitee gets a single-use link valid 72 hours, sets a password, enrols TOTP. Assign roles (Owner ≤ 3, Admin, Moderator, Support, Content editor, Analyst).
7. **Four-eyes:** high-risk actions (member deletion and export, 2FA reset, suspensions by staff, role elevation, bulk actions over 100 records, sensitive config publishes…) execute only when a **second** active staff member with `approvals.decide` and the action's own permission approves within 24 h (ADR-214, 229, 237). Plan for at least **two** people with Owner or Admin before launch; with one person these actions wait forever.
8. A lost authenticator: an Owner requests the reset and a second Owner approves it (four-eyes `staff.reset_two_factor`, ADR-238); neither may be the account concerned. The account then sets a new password through the reset and enrols again. "Authenticator wechseln" in ADM-51 needs a code of the old app, a recovery code is not enough. So a staff member needs two Owners, and an Owner who loses the phone needs two **other** Owners: keep three Owners (the maximum) once the team allows it, and keep recovery codes apart from the phone (`docs/ADMIN_GUIDE.md` 22.3).

Sensitive admin actions ask for the password again if it was not confirmed in the last 5 minutes (`AUTH_PASSWORD_TIMEOUT=300`); the staff session ends after 30 idle minutes.

### IP allow-list and admin domain

- `ADMIN_IP_ALLOWLIST` (IPv4/IPv6 addresses or CIDR, comma separated) is **enforced** on every staff route, the sign-in included: other clients get a plain **404**, without a session row. Empty means `/admin` is reachable from anywhere (still with password + TOTP); do not leave it empty in production.
- The fence decides on the client address that `TRUSTED_PROXIES` settles: list the host's proxy ranges, never `*` (3, ADR-231).
- `ADMIN_DOMAIN` only routes and separates cookies and links. **It is not access control**: anyone can send that Host header. The allow-list is the control.
- Changing your office IP: update `.env`, `php artisan config:cache`. Locked out entirely: edit `.env` over SSH.

### Staging versus production

| | Staging (`APP_ENV=staging`) | Production |
|---|---|---|
| Staff accounts | allowed under the rules above (Owner via `STAFF_OWNER_EMAIL`, allow-list set) | the same |
| `DEMO_STAFF_PASSWORD`, `DEMO_SEED_ON_STAGING` | **empty / false** (a set password creates one demo account per role with a shared password) | never read |
| `/docs/api` | 200 by design, limit it at the host (checklist 2) | 403 |
| Robots | `Disallow: /` | allowed unless `ALLOW_INDEXING=false` |
| Feature flags | the `staging` column of each flag | the `production` column; critical flag changes are four-eyes (ADR-236 g) |

**Open `/admin` on a public host only from a package that contains the M3.8 hardening (security round 2 passed, tag `phase-3` or later).** A host still running a Phase 1 or Phase 2 package keeps the Phase 1 block (`RewriteRule ^(index\.php/)?admin(/|$) - [F,L]` after `RewriteEngine On` in `public/.htaccess`) and no staff account.

## 8. HTTPS and proxies

- Install the host's certificate (Let's Encrypt in the panel) for the exact domain, and for `ADMIN_DOMAIN` if used, before anything else; cookies are `Secure`, App Links need HTTPS.
- `APP_URL` starts with `https://`.
- The redirect from HTTP to HTTPS: on **`APP_ENV=staging` it must come from the host** (panel setting or the host's redirect); `FORCE_HTTPS=true` does nothing there. On `APP_ENV=production`: after checking that `curl -I http://<domain>/` reaches PHP directly, set `FORCE_HTTPS=true` (redirect to `APP_URL`; never for a request with a proxy header, never for `/up`, ADR-126). Either way `curl -I http://<domain>/` must answer a 301 or 302 to `https://` (checklist 4).
- Behind a host proxy that terminates TLS, `TRUSTED_PROXIES` must list it (ranges from the host), otherwise the app sees HTTP and the admin allow-list sees the proxy. Never `*` with the allow-list (3).
- Staging and production APKs (`build-apk.ps1 -Target staging|production`) refuse non-HTTPS URLs.

## 9. Doctor and smoke test

```
php artisan speedclub:doctor
echo $?        # 0 = no BLOCKER (warnings allowed), 1 = at least one BLOCKER
```

It prints a table (OK / WARN / BLOCKER) and ends with `No blockers, N warning(s).` (exit 0) or `N blocker(s), M warning(s). Fix the blockers before going live.` (exit 1). Blockers: PHP version and extensions, GD WebP + FreeType, writable directories, `APP_KEY`, `APP_DEBUG` on in production, queue, storage link, directory listing, `proc_open`, common-password list. Warnings: cron heartbeat, mail, Pusher, HTTPS, logging, migrations, audit triggers, search projection, response flush, `max_execution_time`, active Owner, backups. It also shows whether `ADMIN_IP_ALLOWLIST` is set (the number of entries). Expected WARNs on a first deploy: **Cron heartbeat** until the first minute with cron has passed (and right after every `optimize:clear`), **Pusher** (optional), **Mail** until SMTP is set, **Response flush** (always on the CLI: check `phpinfo()` of the web PHP once for `fastcgi_finish_request`), **Active Owner** until the Owner has set the password (7; the message names the key `SPEEDCLUB_OWNER_EMAIL`, it means `STAFF_OWNER_EMAIL`), **Backups** until `BACKUP_ARCHIVE_PASSWORD` is set and the first backup ran (12). On `APP_ENV=staging` "HTTPS" shows OK with "Plain http (staging)". The doctor does **not** check whether the allow-list holds the right addresses, push, AI, or whether a backup can be restored: the smoke test and 12 cover those.

Smoke test in a browser or with curl:

| URL | Expected |
|---|---|
| `/up` | 200 |
| `/` | the public landing page (German) |
| `/app` | 301 to `/app/`, then the member web app (Welcome / sign-in) |
| `/app/assets/assets/fonts/web/Inter-Regular.<hash>.woff2` (name from `unzip -l speedclub-web-….zip \| grep 'fonts/web/Inter-Regular'`) | **200**, a font file (`font/woff2`) |
| `/api/v1/app-config` | 200 (JSON) |
| `/admin/login` from an **allow-listed** address | 200, the German staff sign-in |
| `/admin`, `/admin/login`, `/index.php/admin/login`, `POST /admin/login` from **any other** address (phone on mobile data) | **404**, empty body |
| `/admin/forgot-password` (allow-listed) | 200, "Passwort vergessen?" form |
| `/robots.txt` | `Disallow: /` on staging; production allows and names the sitemap |
| `/.well-known/assetlinks.json` | your package name and certificate |
| `/.well-known/apple-app-site-association` | with `IOS_TEAM_ID`: `<Team ID>.de.speedclub.app` and the paths `/v/*`, `/u/*`, `/c/*`, `/C/*`; without it an empty `details` list |
| `/impressum`, `/datenschutz`, `/agb`, `/community-richtlinien` | 200, no `[[…]]` visible |
| `/melden`, `/kontakt`, `/konto-loeschen` (WEB-09, WEB-10, WEB-05) | 200, the German form; with Turnstile keys the widget shows |
| `/app-laden` (WEB-04) | 200; on staging with `TESTER_APK_URL` the download link and its SHA-256 |
| `/sitemap.xml` | 200 (after the first 03:30 UTC run, or at once with `php artisan sitemap:generate`) |
| `/dev/mail`, `/admin/dev/gallery`, `/_inertia/devtools/entries`, `/.env` | **404** |
| `/docs/api` | staging: 200 by design, 403 from other addresses with checklist 2; production: 403 |

Then: register a member with a real address, confirm the verification mail arrives, upload a photo, open the public page of the build (QR target), send a test report through `/melden` and check it appears in the admin's moderation queue (ADM-20) and as mail to `MODERATION_EMAIL`. Open **Releases** in the admin (ADM-38): the builds of `RELEASES.md` are listed.

## 10. Mail, realtime, push, AI

### Mail

SMTP of the host or a transactional provider in the EU: `MAIL_MAILER=smtp`, `MAIL_SCHEME=smtps` with port 465 (or `smtp` with 587), `MAIL_HOST`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS` (an address on your domain), `MAIL_FROM_NAME="SPEED CLUB"`. Set SPF and DKIM (and a DMARC record) for the sending domain, otherwise codes land in spam. Test:

```
php artisan tinker --execute="Mail::raw('Test', fn (\$m) => \$m->to('you@example.de')->subject('SPEED CLUB Test'));"
```

Sign-in, verification and reset codes leave synchronously after the response (ADR-130), everything else through the queue. After `.env` changes run `php artisan config:cache`.

### Realtime (Pusher, optional)

Messaging works without Pusher (polling). With a Pusher Channels app in the EU cluster set all of `PUSHER_APP_ID`, `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, `PUSHER_APP_CLUSTER=eu`, `BROADCAST_CONNECTION=pusher` (ADR-201). **In the Pusher app settings keep "subscription counting" and client events off.** Outbound HTTPS to `api-eu.pusher.com` must be allowed. The doctor's "Pusher" check turns OK with the id, key and secret set. The app builds need `EXPO_PUBLIC_PUSHER_KEY` and `EXPO_PUBLIC_PUSHER_CLUSTER=eu` (`docs/IOS_TESTFLIGHT.md` step 4; the member web reads them from app-config).

### Push (Expo, optional, OA-14)

1. The owner creates the Expo project (`eas init`, `EAS_PROJECT_ID`), uploads the **FCM V1** service-account key (Android) and lets EAS create the **APNs** key (iOS) in the Expo dashboard → Credentials. App builds need `EAS_PROJECT_ID` and `GOOGLE_SERVICES_JSON` at build time.
2. **Enhanced push security (recommended for production, SEC-P2-14):** expo.dev → project → Settings → Push → turn on "Enhanced Security for Push Notifications", create an access token (Account settings → Access tokens; a robot user's token is best) and put it into `EXPO_ACCESS_TOKEN`. Without it, anyone who learns a device's push token could send that device pushes (the app opens only internal paths, so the damage is limited to spam). **Order matters:** set the token on the server first, `config:cache`, then switch the setting on; with the setting on and no token every push fails.
3. `PUSH_ENABLED=true`, `php artisan config:cache`. Pushes go through the queue to `exp.host` (outbound HTTPS); receipts are checked every 15 minutes. Message previews are off by default for members (docs/08 §1).

### AI features (optional, OA-18)

1. Decide the provider (Anthropic by default, ADR-030), sign its data-processing agreement, check the region, and name it in the privacy policy (`[[KI-Anbieter]]`, §7 and §8 of the Datenschutzerklärung) **before** switching anything on.
2. `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=…` (both needed), `php artisan config:cache`.
3. In the admin: **Feature-Flags** (ADM-36) → switch the `ai.*` flags you want on per environment (in production critical flags are four-eyes). Each feature has a daily call budget (`AI_DAILY_*`); above it the feature answers "ausgelastet" until midnight Berlin time.
4. Members must opt in to AI suggestions themselves; every AI output is labelled (AI Act Art. 50) and never published without confirmation. Moderation triage only ranks; humans decide (ADR-243).
Without both keys the flags cannot be switched on, and the app shows no AI entries.

### Moderation and forms

- Notices from the app and `/melden`, and appeals, arrive in the admin's moderation queue (ADM-20…23) and as mail to `MODERATION_EMAIL`. DSA deadlines run from receipt: someone must look at the queue every working day.
- Turnstile: create a widget for the exact domain in the Cloudflare dashboard (mode "Managed"), set both keys, `php artisan config:cache`, then load `/melden`: the challenge must appear and a submit must pass.

## 11. Updates

1. Build the new package, check the `.sha256`, upload it next to the old one. **Take a backup (12) first.**
2. `php artisan down`.
3. Keep `.env` and `storage/` (photos in `storage/app/public`, private files in `storage/app/private`, backups). Replace the code: remove `app bootstrap config database lang public resources routes scripts vendor` and the files `RELEASES.md PACKAGE_INFO.txt` (overwriting without removing leaves deleted files behind). Removing `public/` also removes the `public/storage` **link** (only the link). Then, from the folder above (`~`): `unzip -o speedclub-web-….zip`.
4. In `~/speedclub`:
   ```
   php artisan storage:link
   php artisan migrate --force
   php artisan db:seed --class=StaffSeeder --force        # adds new roles/atoms only, never undoes ADM-41/42 edits (ADR-244)
   php artisan db:seed --class=FeatureFlagSeeder --force  # adds new flags only (firstOrCreate), never changes existing ones
   php artisan db:seed --class=ConfigSeeder --force       # adds new config keys only, skips keys that exist
   php artisan db:seed --class=HelpArticleSeeder --force  # adds new help articles only
   php artisan speedclub:releases-sync --path=RELEASES.md
   php artisan optimize:clear
   php artisan optimize
   ```
   **Never `php artisan db:seed` without `--class` on an existing host** (7, ADR-234). On staging, put the `/docs` rule of checklist item 2 back into `public/.htaccess` (the update replaced the file).
5. `php artisan up`, run the doctor (Storage link OK, no "search projection" warning; "Cron heartbeat Never seen" is expected for a minute after `optimize:clear`), repeat the smoke test.

**First update to Phase 3** (from a 0.2.x package):
- Before step 2: add the Phase 3 keys to `.env` (3: `ADMIN_IP_ALLOWLIST`, `STAFF_OWNER_EMAIL`, `BACKUP_ARCHIVE_PASSWORD`, `HEALTH_TO_ADDRESS`, optional `ADMIN_DOMAIN`, `AI_*`).
- Step 4 applies the Phase 3 migrations (admin, approvals, catalogue merges, brand/content/config, team, privacy requests, AI) and the named seeders create the roles, atoms and, with `STAFF_OWNER_EMAIL` set, the Owner (7). Then follow "The first Owner".
- Remove the Phase 1 `/admin` block from `public/.htaccess` **only** under the condition at the end of 7; it is gone anyway after step 3 (the update replaces the file), so do not put it back unless that condition is not met.
- Whether the named seeders alone bring a 0.2.0 database to the same state as a fresh 0.3.x install is checked by the update part of the dry run (13, B).

**Earlier first updates** (still valid when jumping several versions): to M2.3 or later run `php artisan search:rebuild` before `up` (DISC-02 facets); to Phase 2 add the Phase 2 keys (`HOME_CLOCK=` empty, `MODERATION_EMAIL`, `SUPPORT_EMAIL`, `TESTER_APK_*` on staging, Turnstile).

A failed migration: `php artisan down` stays on; restore the database backup taken before the update and the previous package, then `up`.

> **Once after updating to Phase 3 (1.0.0):** `php artisan speedclub:exports:expire-ticket-notes` — expires member data exports built before SEC-P3-12 (they could contain internal support notes); members can request a new one.

## 12. Backups and the restore test

**What must be backed up:** the database; `storage/app/public` (photos, OG cards, brand assets); `storage/app/private` (chat photos, originals, exports, evidence, audit exports); `.env` (separately, encrypted: password manager or the host's secret store). The code is the package zip: keep the last two.

**Built in (ADR-250).** `config/backup.php` backs up the database (a single-transaction dump with triggers, no table locks) plus `storage/app/public` and `storage/app/private`, **never `.env`**, into the `backups` disk (`storage/app/backups`, or the folder in `BACKUP_DISK_ROOT` — outside `public/` and outside the backed-up folders; an empty `BACKUP_DISK_ROOT=` means `storage/app/backups`; packages built before the fix after the M3.10 dry run read the empty line as an empty path, and `backup:run` failed with "Unable to create a directory at .", so on such a package comment the line out), AES-256 encrypted with `BACKUP_ARCHIVE_PASSWORD`, kept 30 days, with a failure mail to `BACKUP_MAIL_TO` (else `HEALTH_TO_ADDRESS`, else `SUPPORT_EMAIL`). In production a backup **refuses to run without `BACKUP_ARCHIVE_PASSWORD`** and the doctor reports it as a blocker. The schedule runs it every night; `php artisan backup:run` runs it by hand (do that before every update), `php artisan backup:list` shows the archives and their health, and ADM-48 shows the last backup.

**Still your job:** copy the archives **off the server** (the host's own backup, SFTP to an encrypted location, or an EU S3 bucket as a second `BACKUP_DISK`), because a backup on the same account dies with the account; keep `.env` separately in the password manager. If the host cannot run `mysqldump` (check with the doctor), use the host panel's database backup instead and keep the files part:

```
cd ~ && mkdir -p backups && chmod 700 backups
mysqldump --single-transaction --quick --routines --triggers -h <DB_HOST> -u <DB_USERNAME> -p <DB_DATABASE> | gzip > backups/db-$(date +%F).sql.gz
tar -czf backups/files-$(date +%F).tar.gz -C ~/speedclub storage/app/public storage/app/private
```

`--triggers` matters: the audit chain's tamper triggers live in the database (the doctor's "Audit triggers" check). Never keep backups or `.env` below `public/`.

**MySQL with GTIDs** (`mysql -e "select @@gtid_mode"` prints `ON`; common on MySQL 8 and later): add `--set-gtid-purged=OFF` to the `mysqldump` line. Without it the dump starts with `SET @@GLOBAL.GTID_PURGED=…`, and loading it into another database on the same server fails with `ERROR 3546 … GTID_PURGED cannot be changed` (seen in the M3.10 dry run on MySQL 9.6). MariaDB's `mysqldump` does not know the option; leave it out there. For the built-in job set `DB_DUMP_GTID_PURGED=OFF` in `.env` on such a server: its dump (`db-dumps/mysql-<database>.sql.gz` inside the archive) then has no `GTID_PURGED` line either. Leave the key empty on MariaDB, whose `mysqldump` refuses the option. An archive made before that setting still carries the line: strip it on restore with `gunzip -c … | sed '/GTID_PURGED/d' | mysql …` (one statement per line in mysqldump output; check that the import then exits 0).

**Restore test (once before go-live, then every quarter; also part of the dry run 13):**
1. Create a throwaway database on the host (or locally), e.g. `speedclub_restoretest`, with its own user.
2. `gunzip -c backups/db-<date>.sql.gz | mysql -h <DB_HOST> -u <user> -p speedclub_restoretest`; exit 0. For an archive of the built-in job, first extract `db-dumps/mysql-<database>.sql.gz` with the archive password: the archive is AES-256, which the macOS `unzip` cannot open (exit 81); use 7-Zip (`7z x <archive>.zip`) or PHP's ZipArchive (`setPassword()`), as the M3.10 re-check did.
3. Unzip the same package into a scratch folder, copy `.env` with `DB_DATABASE=speedclub_restoretest` and a different `APP_URL`, unpack the files backup into its `storage/`.
4. `php artisan migrate:status` (all `Ran`, nothing pending), `php artisan audit:verify` (the chain verifies), `php artisan speedclub:doctor` (exit 0), and `php artisan tinker --execute="echo App\Models\User::count().' / '.App\Models\Vehicle::count();"` matches the live numbers of the backup time.
5. Pick one photo path from the database and check that the file exists under `storage/app/public`.
6. Drop the throwaway database and folder. Write date, backup file and results into the operations log.

## Checklist — before a host goes public

Security sources: `docs/reports/security/phase-1.md` §4, `phase-2.md`, Phase 3 rounds (M3.8). Tick every box.

- [ ] **1. Staff area (Phase 3).**
  - [ ] The package is from tag `phase-3` or later (7, last paragraph); otherwise the Phase 1 block stays and no staff account exists.
  - [ ] `ADMIN_IP_ALLOWLIST` set to your fixed addresses; from a phone on mobile data `/admin`, `/admin/login`, `/index.php/admin/login` and `POST /admin/login` answer **404**.
  - [ ] `TRUSTED_PROXIES` lists the host's proxy ranges or is empty, **never `*`** (no `ADMIN_IP_ALLOWLIST is set with TRUSTED_PROXIES=*` line in `storage/logs`).
  - [ ] `DEMO_STAFF_PASSWORD` and `DEMO_MEMBER_PASSWORD` empty, `DEMO_SEED_ON_STAGING=false`.
  - [ ] The Owner set the password through the mailed link and enrolled TOTP; recovery codes are stored. A second Owner or Admin exists for four-eyes. `php artisan tinker --execute="echo App\Models\Staff::whereNull('two_factor_confirmed_at')->count();"` prints `0` once everyone has enrolled.
- [ ] **2. Dev routes and API docs.** `/dev/mail`, `/admin/dev/gallery` and `/_inertia/devtools/entries` answer **404**; `APP_ENV` is `staging` or `production`, `APP_DEBUG=false`. On a staging host limit `/docs/api` in `public/.htaccess`, directly after `RewriteEngine On`:
    ```
    RewriteCond %{REMOTE_ADDR} !=203.0.113.10
    RewriteRule ^(index\.php/)?docs(/|$) - [F,L]
    ```
    (replace the address; behind a host TLS proxy use the panel's IP protection instead). Check from mobile data that `/docs/api`, `/docs/api.json` and `/index.php/docs/api` answer 403. Re-apply after every update.
- [ ] **3. Package checks.** `PACKAGE_INFO.txt`: `mobile: clean`, `legal placeholders: none`. `unzip -p speedclub-web-….zip speedclub/config/auth.php | grep -n "'timebox'"` shows the staff timebox (SEC-P1-19).
- [ ] **4. Public-facing basics.**
  - [ ] HTTPS valid (also on `ADMIN_DOMAIN`), `APP_URL` is `https://…`, `SESSION_SECURE_COOKIE=true`, doctor exit 0.
  - [ ] `curl -I http://<domain>/` answers a redirect to `https://` (8).
  - [ ] `/robots.txt` disallows everything on staging.
  - [ ] `.env` is `chmod 600`, not inside `public/`; `https://<domain>/.env` and `https://<domain>/RELEASES.md` answer 404.
  - [ ] All legal documents carry the real details and were checked (7, OA-10, OA-17); the org settings (ADM-52) are filled.
  - [ ] Cron runs (doctor: Cron heartbeat OK after a few minutes), `HEALTH_TO_ADDRESS` receives mail.
  - [ ] A backup exists and the restore test passed (12).
- [ ] **5. Optional services decided:** Pusher (OA-13), push with enhanced security (OA-14), Turnstile, AI (OA-18) — each either configured and smoke-tested or knowingly off.

## 13. Dry run of the Phase 3 package (M3.10 exit gate)

The exit gate needs "DEPLOY.md verified by a dry run on a clean local copy (fresh DB, `migrate --force`, doctor passes)". Procedure for the lead (macOS dev machine; nothing here touches `:8080`, `:8081`, `web/public/app` or the `speedclub*` databases in use):

**Preparation**
1. Commit everything (M3.9 docs included), then build: `node scripts/dev/package-web.mjs > docs/reports/logs/m310-package-web.log 2>&1` (background, several minutes; waits for the QA lock). It must end with `OK`. Note zip, SHA-256 and commit.
2. Check the zip: `shasum -a 256 -c <zip>.sha256`; `unzip -t <zip>` without errors; `unzip -p <zip> speedclub/PACKAGE_INFO.txt` (`mobile: clean`); `unzip -l <zip> | grep -E '\.env'` shows only the two examples; no `tests/`, `node_modules` outside `public/app/assets/node_modules`, `public/storage`, keystore or `gradle.properties`; `speedclub/RELEASES.md`, `speedclub/lang/admin/de/*.json` and `speedclub/routes/admin/*.php` are present.
3. Clean folder and database:
   ```
   D=/private/tmp/speedclub-dryrun && rm -rf $D && mkdir -p $D && cd $D && unzip -q <zip>
   mysql -u root -e "DROP DATABASE IF EXISTS speedclub_dryrun; CREATE DATABASE speedclub_dryrun CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   ```
4. `.env`: `cd $D/speedclub && cp .env.production.example .env && chmod 600 .env`, then set only: `APP_ENV=staging`, `APP_URL=http://localhost:8092`, `DB_HOST=127.0.0.1`, `DB_DATABASE=speedclub_dryrun`, `DB_USERNAME`/`DB_PASSWORD` of the local MySQL, `SANCTUM_STATEFUL_DOMAINS=localhost:8092`, `CORS_ALLOWED_ORIGINS=http://localhost:8092`, `SESSION_SECURE_COOKIE=false` (no TLS locally), `MAIL_MAILER=log`, `MAIL_FROM_ADDRESS=noreply@dryrun.example` (empty, every mail fails: the log shows only "A deferred auth step failed" with a `Symfony\Component\Mime\Exception\LogicException`), `LOG_LEVEL=debug` (the example's `warning` drops the log mailer's entries, so the reset link never reaches the log), `ADMIN_IP_ALLOWLIST=127.0.0.1`, `STAFF_OWNER_EMAIL=owner@dryrun.example`, `ANDROID_CERT_SHA256` = the upload key. Everything else as in the example.
5. Web server: Homebrew Apache on `127.0.0.1:8092` and `[::1]:8092` with docroot `$D/speedclub/public` and `AllowOverride All`, PHP-FPM 8.4 on `127.0.0.1:9092` (`clear_env = yes`, `memory_limit = 256M`), as in the M2.9 dry run.

**A. First deploy** (each command must exit 0; record it):
```
php artisan key:generate --force
php artisan down
php artisan migrate --force
php artisan db:seed --force               # expect "Owner account ready. Set its password through the staff password reset."
php artisan storage:link
php artisan speedclub:releases-sync --path=RELEASES.md
php artisan optimize
php artisan up
php artisan schedule:run                  # once: heartbeats, then queue:work
php artisan speedclub:doctor; echo "doctor exit $?"
```
Doctor: **exit 0** = no BLOCKER (the gate); exit 1 = a blocker, which fails the dry run. Expected WARNs: Mail (log mailer), Pusher, Response flush (CLI), Active Owner (until the onboarding below), Backups (`BACKUP_ARCHIVE_PASSWORD` is not set here). "HTTPS" shows OK on staging ("Plain http (staging)"). On a later doctor run without cron, Cron heartbeat turns WARN after a few minutes. Any other WARN is investigated and recorded.

**Smoke checks** (curl against `http://localhost:8092`): every row of 9 that applies locally, plus:
- admin fence: the request must keep the host name `localhost:8092`, because the app answers **400** to the host names `127.0.0.1` and `[::1]` (trusted hosts come from `APP_URL`). So choose the loopback with `--resolve`: `curl -s -o /dev/null -w '%{http_code}' --resolve localhost:8092:127.0.0.1 http://localhost:8092/admin/login` → 200; the same with `--resolve 'localhost:8092:[::1]'` for `/admin`, `/admin/login`, `/index.php/admin/login` and `POST /admin/login` → **404** with an empty body (`::1` is not allow-listed);
- Owner onboarding from 127.0.0.1 in a browser: "Passwort vergessen?" → the reset link appears in `storage/logs/laravel-*.log` (log mailer) → set password → sign in → two-factor setup → enter a code → dashboard. Record that the page asks for TOTP before anything else;
- the admin's Releases page (ADM-38) lists the builds of `RELEASES.md`; if the system pages of M3.6 are in the package, they show Pusher, push and AI as not configured;
- `/api/v1/app-config` 200; no `ai` feature enabled; `/robots.txt` `Disallow: /`.

**B. Update from the Phase 2 package** (`releases/web/speedclub-web-0.2.0-20261108-1855.zip`, if still present): deploy 0.2.0 to a second database `speedclub_dryrun_b` as in M2.9, then run 11 with the "first update to Phase 3" additions. Compare `roles`, `permissions`, `role_has_permissions`, `feature_flags` and `config_versions` with A. A raw `mysqldump --no-create-info --skip-extended-insert … | sort | diff` always differs, because ids and `created_at` differ between two installs; compare the rows by name instead (role and permission names, grants as role name + permission name, flag key + `enabled` + `rules` + description, config key + version + status + payload), without ids and timestamps. A difference means 11 needs another seeder or a data step, which the dry run notes must record.

**C. Backup and restore test** on A: the manual procedure of 12, then the restore steps into `speedclub_restoretest`; `audit:verify` and the doctor pass.

**Clean-up:** stop the dry-run Apache and FPM, `DROP DATABASE speedclub_dryrun; DROP DATABASE speedclub_dryrun_b; DROP DATABASE speedclub_restoretest;`, `rm -rf /private/tmp/speedclub-dryrun`. Write "Dry run notes (Mac, <date>, M3.10)" below with: package name, SHA-256, commit, every command with its exit code, doctor summary line, smoke rows, B diff result, C result, and what was **not** run (anything on a real host, TLS, SMTP, Pusher, push, AI with a real key, the cron entry over time).

## Dry run notes (Mac, 2026-11-10, M3.10)

Package `speedclub-web-1.0.0-20261110-0527.zip` (33.3 MB, 20 962 entries, SHA-256 `c1d6a69bf3c860451071b118eebde09dff9a422d07ce26d64b82ea15607281ea`), built with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-web.ps1` (pwsh, which runs `scripts/dev/package-web.mjs`) from the clean tree at `e8f9d3f`; exit 0, ends with `OK`, `PACKAGE_INFO.txt` reads `mobile: clean`. Build log: `docs/reports/logs/m310-package-web.log`. Content checks: `docs/reports/logs/m310-package-check-1.0.0.log`. Dry run: `docs/reports/logs/m310-dryrun-1.0.0.log`. The legal texts still hold `[[…]]` placeholders (10 files, 78 lines), so **no public host may seed from it** (7, OA-10).

- **Ran by the script:** composer `--no-dev -o`, `npm ci` + `vite build` in the stage, the production Expo export through the QA lock. Its own checks passed: no `qa:start`, no `qaTheme` or `qaFlags` in any JS file, every built file packed, the 25 assets the bundle names all present, 7 font files.
- **Ran on the zip (13, step 2):**
  - `shasum -a 256 -c` OK (exit 0); `unzip -tq` no errors (exit 0); one top folder `speedclub/`.
  - The only `.env*` files are `.env.example` and `.env.production.example`, both identical to the committed files. `speedclub/RELEASES.md` is identical to `docs/RELEASES.md` of `e8f9d3f`.
  - None of these: `tests/` or `e2e/` outside `vendor/`, `node_modules` outside `public/app/assets/node_modules`, `public/storage`, `public/hot`, log files, keystore, `.jks`, `.p12`, `.pem`, `gradle.properties`, phpunit/pest files outside `vendor/`.
  - Present: `routes/admin.php` and 22 `routes/admin/*.php`; `lang/admin/de` and `lang/admin/en` with 27 JSON files each; `storage/app/private`. `vendor/composer/installed.json` has `"dev": false`, and no faker, pest, phpunit, pint, larastan or boost is in `vendor/`. `public/app` has 93 JS files. Checklist 3: `'timebox' => 500000`.
- **Setup:** unzipped into `/private/tmp/speedclub-dryrun` (exit 0). Homebrew Apache 2.4.69 on `127.0.0.1:8092` and `[::1]:8092` (docroot `…/speedclub/public`, `AllowOverride All`, `Options -Indexes`), PHP-FPM 8.4.17 on `127.0.0.1:9092` (`clear_env = yes`, `memory_limit` 256M), MySQL 9.6 (`gtid_mode=ON`). `:8080`, `:8081`, `web/public/app` and the `speedclub`, `speedclub_qa` and `speedclub_testing*` databases were not touched. `.env` by `cp .env.production.example .env` + `chmod 600` with the keys of step 4 as it read then. Two keys had to be added for the onboarding (`MAIL_FROM_ADDRESS`, `LOG_LEVEL=debug`, see A); step 4 now names them.
- **A: first deploy on `speedclub_dryrun`.** `key:generate --force`, `down`, `migrate --force` (56 migrations), `db:seed --force` (prints `Owner account ready. Set its password through the staff password reset.`), `storage:link`, `speedclub:releases-sync --path=RELEASES.md` (`Releases: 5 new, 0 updated, 0 unchanged, 1 duplicate headings`), `optimize`, `up`, `schedule:run` (both heartbeats, then `queue:work --stop-when-empty --max-time=50 --tries=3`), `speedclub:doctor`: **every command exit 0.**
  - **Doctor: exit 0, `No blockers, 5 warning(s).`** WARNs: Mail (log mailer), Pusher (not configured), Response flush (CLI), Active Owner ("No active Owner…", before the onboarding), Backups ("BACKUP_ARCHIVE_PASSWORD is empty"). OK among others: APP_DEBUG off, 56 migrations, audit triggers, Cron heartbeat 0 min, queue without backlog, search projection, storage link, directory listing off, `proc_open`, common passwords (10 000), admin IP allow-list (1 entry), HTTPS "Plain http (staging)". The expected HTTPS WARN of the old text did not appear; Active Owner and Backups were missing from that list. 13 is corrected.
  - After the onboarding the doctor again exited 0 with `No blockers, 5 warning(s).`: Active Owner turned OK ("1 active Owner(s)"), and Cron heartbeat turned WARN ("Last seen 7 min ago"; no cron entry on this machine).
  - **Smoke, 33 rows, all as expected:**
    - 200 from `/up`, `/` (German landing page), `/app/`, the Inter 400 font under `/app/assets/node_modules/…` (`font/ttf`), `/api/v1/app-config`, `/robots.txt` (`Disallow: /`), `/.well-known/assetlinks.json` (`95:EF:80:0D…`), `/.well-known/apple-app-site-association` (empty `details`), `/impressum`, `/datenschutz`, `/agb`, `/community-richtlinien`, `/melden`, `/kontakt`, `/konto-loeschen`, `/app-laden`, `/sitemap.xml` and `/docs/api` (staging, by design; the checklist 2 rule was not inserted).
    - `/app` answers 301.
    - Admin fence: from `127.0.0.1`, `/admin/login` (Inertia `Auth/Login`, `lang="de"`) and `/admin/forgot-password` (`Auth/ForgotPassword`) answer 200, and `/admin` answers 302 to the sign-in. From `::1`, GET `/admin`, `/admin/login`, `/index.php/admin/login`, `/admin/forgot-password` and POST `/admin/login`, `/index.php/admin/login` all answer **404 with an empty body**.
    - 404 from `/dev/mail`, `/admin/dev/gallery` (from `127.0.0.1`), `/_inertia/devtools/entries`, `/.env` and `/RELEASES.md`. `/storage/media/` shows no "Index of".
    - The first attempt used `http://127.0.0.1:8092/…` and `http://[::1]:8092/…` as the old text said, and got **400** on every admin row. The app accepts only the host of `APP_URL`, so the requests must keep `Host: localhost:8092` and choose the loopback with `curl --resolve`. 13 is corrected; this is not a defect of the package.
  - `app-config`: every `ai.*` flag is `false`, so no AI feature is on. `latest_version` is `{"ios":"0.1.0","android":"0.1.0"}` (the seeded value; ADM-35 sets it).
  - **Owner onboarding, with curl from `127.0.0.1` (no browser):**
    - First "Passwort vergessen?" POST: 302, but no mail. The log held only `A deferred auth step failed. {"type":"Symfony\\Component\\Mime\\Exception\\LogicException"}`, because `MAIL_FROM_ADDRESS` was empty. Set it and ran `config:cache` (exit 0).
    - Second POST: 302, the token row was renewed, no error, still no mail in the log: `LOG_LEVEL=warning` from the example drops the log mailer's entries. Set `LOG_LEVEL=debug` and ran `config:cache` (exit 0).
    - Third POST: 302. `storage/logs/laravel-2026-11-10.log` holds the mail to `owner@dryrun.example`, subject "Passwort zurücksetzen", with the link `http://localhost:8092/admin/reset#token=…&email=owner%40dryrun.example`.
    - `POST /admin/reset-password` with that token and a new password: 302 to `/admin/login`; `password_proof_required` went from 1 to 0.
    - `POST /admin/login`: 302 to `/admin`. Then `/admin`, `/admin/members` and `/admin/team` all answer **302 to `/admin/two-factor/setup`** (`Auth/TwoFactorSetup`). **The admin asks for TOTP before anything else.**
    - Enabling TOTP first answered 423 "Password confirmation required."; `POST /admin/user/confirm-password` 201, then enable 200, secret key 200, and `confirmed-two-factor-authentication` with a code computed from the key 200. Then `/admin` answers 200 (`Dashboard/Index`). `Staff::whereNull('two_factor_confirmed_at')->count()` prints `0`.
    - Releases (ADM-38, `/admin/config/releases`): 200, five builds: 1.0.0/6, 0.2.0/4, 0.2.0/3, 0.1.0/2, 0.1.0/1. The heading "1.0.0 (Build 5) … - superseded, not distributed" does not match the register's heading pattern, so Build 5 is not listed. The "1 duplicate" is the two "0.1.0 (Build 1)" headings.
    - System → Integrations (`/admin/system/integrations`): 200; mail (log), Pusher, push, AI, Turnstile and Sentry all `configured: false`.
- **B: first update from 0.2.0 on `speedclub_dryrun_b`.** `releases/web/speedclub-web-0.2.0-20261108-1855.zip` (`shasum -c` OK) unzipped into a second folder. `.env` from its own example with the A keys, without the Phase 3 values. Its step 4 (`key:generate`, `down`, `migrate --force` with 43 migrations, `db:seed --force`, `storage:link`, `optimize`, `up`): all exit 0. The seed prints `STAFF_OWNER_EMAIL is not set: no Owner account created.` The Phase 1 `/admin` block was not put into this throwaway 0.2.0 host.
  - Then 11 with the "first update to Phase 3" additions, every command exit 0:
    - a manual backup (`mysqldump … --set-gtid-purged=OFF`);
    - the Phase 3 keys into `.env` (`ADMIN_IP_ALLOWLIST`, `STAFF_OWNER_EMAIL`, `BACKUP_ARCHIVE_PASSWORD` random, `HEALTH_TO_ADDRESS`);
    - `down`, and removing `app bootstrap config database lang public resources routes vendor RELEASES.md PACKAGE_INFO.txt`;
    - `unzip -o` of the 1.0.0 package, `storage:link`, and `migrate --force`, which applied the 13 Phase 3 migrations;
    - the four named seeders (`StaffSeeder` prints `Owner account ready…`), `speedclub:releases-sync`, `optimize:clear`, `optimize`, `speedclub:exports:expire-ticket-notes` (`0 export(s) expired.`) and `up`.
  - `.env` was unchanged (checksum) with mode `600`. Marker files in `storage/app/public` and `storage/app/private` survived, and the public one answered 200 through the new link.
  - Both packages ship a `scripts/` folder, which 11 did not list for removal (a file deleted there would stay behind). 11 now lists it.
  - After `schedule:run`, with Apache serving B: the doctor exited 0 with `No blockers, 5 warning(s).` The WARNs were Mail, Pusher, Response flush, Active Owner (expected before onboarding) and Backups ("No backup yet"). Cron heartbeat and Migrations (56) were OK.
  - The same 33 smoke rows passed. app-config: no `ai.*` flag on.
  - **Table comparison with A.** The raw `mysqldump --skip-extended-insert | sort | diff` gives 174 differing lines, all ids and `created_at`. Compared by name (13 B now says so): 243 rows on each side, and `roles` (6), `permissions` (57), `role_has_permissions` (156) and `feature_flags` (21) are **identical**. `config_versions` (3) differs in **one value**: `branding.accent_set` is `"default"` on the updated host (written by the 0.2.0 seed) and `"signalRed"` on a fresh install (since `10be0fe`). `ConfigSeeder` skips existing keys, so the update keeps `"default"`, and app-config serves it. The app (`setAccentSet`) and the admin (`AccentSets::resolve`) map an unknown key to the default set `signalRed`, so nothing visible changes; the next branding publish in ADM-28 writes the real key. No further seeder is needed for the staff, flag and config rows.
- **C: backup and restore on A.**
  - The manual procedure of 12 (`mkdir`/`chmod 700`, `mysqldump --single-transaction --quick --routines --triggers | gzip`, `tar -czf` of both storage roots): exit 0.
  - First restore: `gunzip -c … | mysql … speedclub_restoretest` **exit 1**, `ERROR 3546 (HY000) at line 24: @@GLOBAL.GTID_PURGED cannot be changed`. This MySQL has GTIDs on, and the dump carried `SET @@GLOBAL.GTID_PURGED`. Re-dumped with `--set-gtid-purged=OFF`: the import exited 0. 12 now says this.
  - Restore copy: the same zip unzipped, `.env` copied with `DB_DATABASE=speedclub_restoretest` and `APP_URL=http://localhost:8093`, the files backup unpacked into `storage/`, and `storage:link`: all exit 0.
  - Checks: `migrate:status` showed 56 Ran and 0 Pending; `audit:verify` printed `Audit chain intact, 5 events checked.` (exit 0).
  - The doctor exited 0 with `No blockers, 6 warning(s).`: Cron heartbeat (restored cache), Mail, Pusher, Directory listing (nothing serves `:8093`), Response flush and Backups.
  - Counts: users / vehicles `0 / 0`, staff 1, audit 5, media 0, the same as live at backup time. Both storage markers were restored. Step 5 (one photo path) could not run, because the fresh host has no media rows.
  - **Built-in job (ADR-250), beyond 13:**
    - `php artisan backup:run` on A **failed** (exit 1): `Could not connect to disk backups because: League\Flysystem\UnableToCreateDirectory: Unable to create a directory at .`. The cause is the line `BACKUP_DISK_ROOT=` (empty) in `.env.production.example`: `env()` returns `''` and not the default, so `filesystems.disks.backups.root` is `''`.
    - With that line commented out, the job completed: 7 files, the dump with 2 triggers. But the dump inside the archive holds a `SET @@GLOBAL.GTID_PURGED` line, and importing it into a scratch database failed with the same `ERROR 3546` (exit 1).
    - On B (the 0.2.0 `.env` has no `BACKUP_DISK_ROOT` line, and the password was set), `backup:run` exited 0.
    - Both are reported to the lead as package defects. 12 warns about the empty line and about GTID dumps.
    - **Fixed by the lead after this dry run:** `config/filesystems.php` treats an empty `BACKUP_DISK_ROOT` as unset (`env() ?:`), and `config/database.php` passes `DB_DUMP_GTID_PURGED` (empty: no option; `OFF` on a MySQL with GTIDs) to the built-in dump; both have Pest tests (BackupConfigTest). The final package is rebuilt and re-checked below.
- **Clean-up:** stopping Apache and PHP-FPM (`:8092` and `:9092` closed) and the three `DROP DATABASE`s exited 0. The extra scratch database of the built-in test was dropped right after its test. `rm -rf /private/tmp/speedclub-dryrun` was **not** run: the tool permissions of this session refused it, so it is left for the lead.
- Local artefact, not a package finding: the FPM pool's `max_execution_time = 60` killed the idle workers 60 s after start (SIGALRM on macOS). No request failed.
- **Not run:**
  - Anything on a real host: TLS and the HTTP-to-HTTPS redirect (`SESSION_SECURE_COOKIE=true`, `FORCE_HTTPS`, `curl -I http://…`), SMTP delivery with SPF/DKIM, `ADMIN_DOMAIN`, `TRUSTED_PROXIES`, a host's PHP and `symlink()` limits.
  - Pusher, push (Expo/FCM/APNs), Turnstile, Sentry, S3, AI with a real provider key, and switching an `ai.*` flag on.
  - The cron entry over time: one `schedule:run` per scenario, so no nightly jobs, no scheduled backup, and no `backup:monitor`.
  - A browser. The onboarding ran with curl: the QR code was not shown or scanned (the code was computed from the setup key), and the recovery codes were not viewed or stored.
  - Team invite, a second Owner and four-eyes; member registration with the verification mail; photo and chat-photo uploads; a report through `/melden`; a data export; a browser pass over `public/app` and the admin.
  - A restore from an **encrypted** built-in archive (A had no `BACKUP_ARCHIVE_PASSWORD`, and B's archive was not restored).
  - `/docs/api` with `APP_ENV=production`, and the staging `/docs` rule of checklist item 2.

### Final package re-check (031665b)

Package `speedclub-web-1.0.0-20261110-0635.zip` (33.3 MB, 20 963 entries, SHA-256 `db55b094a457a6d4a4ffd510b644028c51d8a7358ac35a3d9f1e979a5f970087`), built from the clean tree at `031665b` (includes the fixes of `88c818b`) with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-web.ps1` (exit 0, ends with `OK`, waited for the QA lock). It supersedes `speedclub-web-1.0.0-20261110-0527.zip`. Logs: `docs/reports/logs/m310-package-web-final.log`, `docs/reports/logs/m310-dryrun-final.log`.

- **13 step 2:** `shasum -a 256 -c` OK (exit 0); `unzip -tq` no errors (exit 0); one top folder `speedclub/`; `PACKAGE_INFO.txt` reads `mobile: clean`, commit `031665b9…`. The only `.env*` files are the two examples, identical to the committed ones; `speedclub/RELEASES.md` is identical to `docs/RELEASES.md`. No `tests/`/`e2e/` or phpunit/pest files outside `vendor/`, no `node_modules` outside `public/app/assets/node_modules`, no `public/storage`, `public/hot`, logs, keystores or `gradle.properties`. Present: `routes/admin.php` + 22 `routes/admin/*.php`, 27 JSON files each in `lang/admin/de` and `lang/admin/en`, `storage/app/private`, 93 JS files in `public/app`; `installed.json` `"dev": false`. The zip holds both fixes (`env('BACKUP_DISK_ROOT') ?: storage_path('app/backups')` and `mysql_gtid_purged => env('DB_DUMP_GTID_PURGED') ?: 'AUTO'`).
- **Setup:** unzipped into `/private/tmp/speedclub-dryrun-final/run2` (exit 0), fresh `speedclub_dryrun`, Apache 2.4.69 on `127.0.0.1:8092` and `[::1]:8092`, PHP-FPM 8.4.17 on `127.0.0.1:9092` (`clear_env = yes`, 256M), MySQL 9.6 with `gtid_mode=ON`. `.env` from `.env.production.example` + `chmod 600` with exactly the keys of step 4, `BACKUP_DISK_ROOT=` left empty as in the example, `DB_DUMP_GTID_PURGED=` empty, `BACKUP_ARCHIVE_PASSWORD` a throwaway value. (A first attempt in `…/speedclub-dryrun-final/speedclub` is void: the shell loop passed each command with its options as one word, so Artisan answered "Command … is not defined". Not a package finding; that copy was left in place because the tool permissions refused deleting it.)
- **A, every command exit 0:** `key:generate --force` 0, `down` 0, `migrate --force` 0 (56 migrations), `db:seed --force` 0 (`Owner account ready. Set its password through the staff password reset.`), `storage:link` 0, `speedclub:releases-sync --path=RELEASES.md` 0 (`Releases: 5 new, 0 updated, 0 unchanged, 1 duplicate headings`), `optimize` 0, `up` 0, `schedule:run` 0, `speedclub:doctor` **0**.
  - Doctor: **`No blockers, 5 warning(s).`** WARNs: Mail (log), Pusher, Response flush (CLI), Active Owner (now names `STAFF_OWNER_EMAIL`), Backups ("No backup yet", the password is set). OK among others: Migrations 56, audit triggers, HTTPS "Plain http (staging)", Cron heartbeat 0 min.
- **Built-in backup, `BACKUP_DISK_ROOT=` empty:** `backup:run` **exit 0** (3 files, 69.68 KB, written to `storage/app/backups/speedclub/`, every entry AES-256), `backup:list` exit 0 (1 backup, reachable, healthy). With `DB_DUMP_GTID_PURGED=` empty the dump still holds `SET @@GLOBAL.GTID_PURGED` (expected; 12 says to set `OFF` on such a MySQL).
- **`DB_DUMP_GTID_PURGED=OFF`:** `config:clear` 0, `optimize` 0, `backup:run` **exit 0**, `backup:list` exit 0 (2 backups). The archive was opened with the archive password (PHP `ZipArchive`; macOS `unzip` cannot read AES-256 entries and exits 81, so use 7-Zip or PHP on the host), and its dump has **no `GTID_PURGED` line**. `gunzip -c … | mysql … speedclub_restoretest`: **exit 0**. Restored: 85 tables, 2 triggers, 56 migrations, 1 staff, 1 audit event, 57 permissions, 21 flags, the same as `speedclub_dryrun`.
- **Smoke:** `/up` 200, `/api/v1/app-config` 200 (all six `ai.*` flags `false`), `/robots.txt` 200 `Disallow: /`; with `--resolve localhost:8092:127.0.0.1`, `/admin/login` 200; with `--resolve 'localhost:8092:[::1]'`, GET `/admin`, `/admin/login`, `/index.php/admin/login` and POST `/admin/login` all 404 with an empty body.
- **Clean-up:** Apache and FPM stopped (exit 0, `:8092`/`:9092` closed), `DROP DATABASE speedclub_dryrun; DROP DATABASE speedclub_restoretest;` exit 0. `rm -rf /private/tmp/speedclub-dryrun-final` was **refused** by the tool permissions and is left for the lead (as is `/private/tmp/speedclub-dryrun`).
- **Not run in this re-check:** scenario B (update from 0.2.0), the full manual restore of C (files backup, restore copy, `audit:verify`, doctor on the copy), the Owner onboarding and the other 33 smoke rows of the first dry run (since `e8f9d3f`, `web/` outside tests changed in the two config files, the env examples, the doctor hint, moderation preview code, two demo seeders and admin Vue components from the design QA rounds; none of these touch the deploy commands), anything on a real host (TLS, SMTP, proxies, cron over time), Pusher, push, AI, a browser.


---

# History: dry runs of Phases 1–2

> Kept as written at the time. Rules they mention for the staff area (no staff accounts, `/admin` blocked at the host, allow-list not enforced) are Phase 1–2 rules, replaced by 7 above.

## Dry run notes (Mac, 2026-11-08)

Package `speedclub-web-0.1.0-20261108-0144.zip` (30.2 MB, 19 152 entries, SHA-256 `5b69e5cecfda760449253094d041bf103fc7bbb06783b9aa2ddbbd5f6b8c57a2`), built with `node scripts/dev/package-web.mjs` from the clean tree at `81cb418` (`web/` from that commit, `PACKAGE_INFO.txt`: `mobile: clean`). This is the Phase 1 package; the earlier packages of 2026-11-06 (`…-1839`, `…-1927`, `…-1958`, `…-2020-DIRTY`) were mechanics tests and are deleted. Its legal texts still hold `[[…]]` placeholders (10 files, 76 lines), so **no public host may seed from it** (7).

- Ran by the script: composer `--no-dev -o`, `npm ci` + `vite build` in the stage, production Expo export through the QA lock; its own checks passed (no `qa:start` in `index.html`, no `qaTheme` in any JS file, every built file packed, the 25 assets the bundle names all present, 7 font files).
- Ran on the zip: `unzip -t` (no errors), `shasum -a 256` equals the `.sha256` file. One top folder `speedclub/`. No `.env*` but `.env.example` and `.env.production.example`, both identical to the committed files (no values for keys, passwords or secrets); no keystore, `.jks`, `.p12`, `.pem` or `gradle.properties`; no `node_modules` outside `public/app/assets/node_modules`; no `tests`, `e2e`, `.lighthouseci`, `public/storage`, `public/hot` or log files; no phpunit/pest file outside `vendor/`. `vendor/composer/installed.json`: `"dev": false`, 0 dev package names, none of the ten `require-dev` packages (faker, pest, phpunit, pint, larastan, boost, …) in `vendor/`; optimised classmap (10 475 classes). `public/app`: 57 JS files, the bundle holds `"production"` and no LAN or `localhost` address. Vite manifest: 20 keys, none starting with `../`, font keys present. Checklist 3: `'timebox' => 500000` in `config/auth.php`, `TimeboxedPasswordBrokerManager` listed.
- Ran, unzipped into a scratch folder, Apache 2.4.69 + PHP-FPM 8.4.17 (`clear_env`, `memory_limit` 256M) on a private loopback port, MySQL 9.6 scratch database `speedclub_dryrun` (dropped afterwards). `.env` by `cp .env.production.example .env` + `chmod 600` with `APP_ENV=staging`, the database keys, an `http://localhost` `APP_URL`, `SANCTUM_STATEFUL_DOMAINS`/`CORS_ALLOWED_ORIGINS` for that origin and the upload-key `ANDROID_CERT_SHA256`. Every command of step 4 in order, exit 0; the seed prints `STAFF_OWNER_EMAIL is not set: no Owner account created.`, `Staff::count()` prints `0`.
- Smoke test of step 9 with the rules of checklist items 1 and 2 in place: `/up`, `/`, `/impressum`, `/datenschutz`, `/agb`, `/app/`, `/sitemap.xml`, `/api/v1/app-config`, `/api/v1/catalog/makes` answer 200; `/app` 301 to `/app/`; the Inter 400 font under `/app/assets/node_modules/…` 200 (`font/ttf`); every script and icon `/app/index.html` names and every `/build/…` asset `/` names 200; `/robots.txt` `Disallow: /`; `/.well-known/assetlinks.json` names `de.speedclub.app` and the certificate `95:EF:80:…:F0:79`; `/dev/mail`, `/_inertia/devtools/entries`, `/.env`, `/administrator`, `/documents` 404; `/storage/media/` no "Index of".
- The block: GET `/admin`, `/admin/login`, `/index.php/admin`, `/index.php/admin/login`, `/%61dmin/login`, `/index.php//admin/login`, `/index.php/x/../admin/login` and POST `/admin/login`, `/index.php/admin/login`, `/admin/forgot-password`, `/index.php/admin/forgot-password` answer 403; `/ADMIN/login`, `/admin%2Flogin`, `/index.php%2Fadmin/login`, `/index.php/index.php/admin/login` 404. `/docs/api`, `/docs/api.json`, `/index.php/docs/api`, `/index.php/docs/api.json` answer 403 from another address (`::1`, with only `127.0.0.1` listed) and 200 from the listed one.
- Doctor: exit 0, `No blockers, 4 warning(s)` (Cron heartbeat, Mail, Pusher, Response flush); APP_DEBUG off, 26 migrations, audit triggers, GD WebP + FreeType, Storage link and Directory listing OK; HTTPS shows OK as plain http on staging. No config line needed fixing this time.
- Update of step 11: `down`, remove the ten folders, `unzip -o`, `storage:link`, `migrate --force`, `optimize:clear`, `optimize`, rules back in, `up`, all exit 0: `.env` unchanged with mode `600`, the same smoke results, the doctor shows "Storage link" OK and no blockers.
- **Not run:** anything on a real host, TLS and the HTTP-to-HTTPS redirect (no certificate here, so `SESSION_SECURE_COOKIE`, `FORCE_HTTPS` and `curl -I http://…` are unproven), a member registration with mail, a photo upload, the cron entry and queue, `/docs/api` with `APP_ENV=production` (covered by `SkeletonTest` and `PhaseOneSecurityTest`), and a browser pass over `public/app` (the DEV-01 redirect stubs and the ignored `?qaTheme` were last checked in a browser on the 2026-11-06 package `…-1927`; this package's script check finds no `qaTheme` in any JS file). A real host run follows in M3.9.

## Dry run notes (Mac, 2026-11-08, M2.9)

Package `speedclub-web-0.2.0-20261108-1855.zip` (31.0 MB, 19 675 entries, SHA-256 `5550765fa564f6342d7a6c284fcbd865c5bf97cc4c5849047605382b3bd69506`). It was built with `scripts/package-web.ps1` (pwsh, which runs `scripts/dev/package-web.mjs`) from the clean tree at `b4994a1`; `PACKAGE_INFO.txt` reads `mobile: clean`. Build log: `docs/reports/logs/m29-package-web-0.2.0.log`. Content checks: `docs/reports/logs/m29-package-check-0.2.0.log`. Dry run: `docs/reports/logs/m29-dryrun-0.2.0.log`. The legal texts still hold `[[…]]` placeholders (10 files, 78 lines), so **no public host may seed from it** (7, OA-10).

- **Ran by the script:** composer `--no-dev -o`, `npm ci` + `vite build` in the stage, and the production Expo export through the QA lock (it waited for a Playwright run of the test engineer). Its own checks passed: no `qa:start`, no `qaTheme`, every built file packed, the 25 assets the bundle names all present, 7 font files.
- **Ran on the zip:**
  - `unzip -t` showed no errors, and `shasum -a 256` equals the `.sha256` file. There is one top folder, `speedclub/`.
  - The only `.env*` files are `.env.example` and `.env.production.example`, both identical to the committed files.
  - The zip holds no keystore, `.jks`, `.p12`, `.pem` or `gradle.properties`. It has no `node_modules` outside `public/app/assets/node_modules`; no `tests`, `e2e`, `.lighthouseci`, `public/storage`, `public/hot` or log files; and no phpunit/pest file outside `vendor/`.
  - `vendor/composer/installed.json` has `"dev": false`, and none of faker, pest, phpunit, pint, larastan or boost is in `vendor/`.
  - `public/app` has 91 JS files and no LAN or `localhost:8080` address. The Vite manifest has no key outside `web/`.
  - Checklist 3: `'timebox' => 500000` and `TimeboxedPasswordBrokerManager` are present. `storage/app/private` is in the zip.
- **Setup:** unzipped into a scratch folder. Homebrew Apache 2.4 on `127.0.0.1:8092` and `[::1]:8092` with PHP-FPM 8.4.17 on `127.0.0.1:9092` (`clear_env = yes`, `memory_limit` 256M). The databases were MySQL 9.6 scratch databases `speedclub_dryrun_m29a` and `speedclub_dryrun_m29b`, both dropped afterwards. The running `:8080`/`:8081` servers and the `speedclub`, `speedclub_qa` and `speedclub_testing*` databases were not touched. `.env` came from `cp .env.production.example .env` + `chmod 600` with:
  - `APP_ENV=staging`, the database keys, `APP_URL=http://localhost:8092`, and `SANCTUM_STATEFUL_DOMAINS`/`CORS_ALLOWED_ORIGINS` for that origin;
  - `MAIL_MAILER=log`, the upload-key `ANDROID_CERT_SHA256`, and the Phase 2 keys of 3 (`HOME_CLOCK=` empty, `SUPPORT_EMAIL`, `MODERATION_EMAIL`, and `TESTER_APK_URL`/`TESTER_APK_SHA256` set to the 0.2.0 APK's checksum).
  The rules of checklist items 1 and 2 were inserted after `RewriteEngine On`, with `/docs` allowed for `127.0.0.1` only.
- **A: first deploy of 0.2.0.** Every command of step 4 ran in order with exit 0. The seed prints `STAFF_OWNER_EMAIL is not set: no Owner account created.`, and `Staff::count()` prints `0`.
  - Smoke test of step 9, 32 rows, all as expected:
    - 200 from `/up`, `/`, `/impressum`, `/datenschutz`, `/agb`, `/app/`, the Inter 400 font under `/app/assets/node_modules/…`, `/robots.txt` (`Disallow: /`), `/.well-known/assetlinks.json` (`95:EF:80:0D…`), `/.well-known/apple-app-site-association` (empty `details`, no `IOS_TEAM_ID`), `/api/v1/app-config`, `/api/v1/catalog/makes` and `/sitemap.xml`. Also 200 from the Phase 2 pages `/melden` (with the good-faith field), `/kontakt`, `/konto-loeschen`, `/app-laden` (shows the APK's SHA-256), `/email/verify` and `/email/reset`.
    - `/app` answers 301.
    - 403 from GET `/admin`, `/admin/login`, `/index.php/admin/login` and `/%61dmin/login`, and from POST `/admin/login` and `/index.php/admin/login`. `/docs/api` answers 200 from `127.0.0.1`; from `::1`, `/docs/api` and `/index.php/docs/api.json` answer 403.
    - 404 from `/dev/mail`, `/_inertia/devtools/entries` and `/.env`.
    - `/storage/media/` shows no "Index of", and the 7 assets that `/app/` and `/` name all answer 200.
  - `app-config` serves `latest_version` `{"ios":"0.1.0","android":"0.1.0"}`, the seeded value (RELEASES 0.2.0, app-config note).
  - One `schedule:run` (heartbeats, then `queue:work --stop-when-empty --max-time=50 --tries=3`) exited 0. The doctor then exited 0 with `No blockers, 3 warning(s)` (Mail, Pusher, Response flush), 43 migrations, and Cron heartbeat OK.
- **A: update of step 11 with the same package.** `down`, removing the ten folders, `unzip -o`, `storage:link`, `migrate --force`, `optimize:clear`, `optimize`, putting the rules back and `up` all exited 0.
  - `.env` was unchanged (checksum) with mode `600`. A marker file in `storage/app/public` and one in `storage/app/private` survived, and the public one answered 200 through the new `storage` link.
  - The same 32 smoke rows passed.
  - The doctor showed `No blockers, 4 warning(s)`. The fourth is **Cron heartbeat "Never seen"**: `optimize:clear` empties the cache that holds the heartbeat (`CACHE_STORE=database`). On a host with the cron entry it turns OK again within a minute. Expect it right after every update.
- **B: first update to Phase 2.** The 0.1.0 package was deployed first, with step 4 and the Phase 1 smoke rows all as expected. Then came step 11 with the "first update to Phase 2" additions: the Phase 2 keys went into `.env` before step 2, and `search:rebuild` ran after `migrate --force` (it printed `Rebuilt 0 vehicles.`, since the scratch host has no builds).
  - `migrate --force` applied the 12 Phase 2 migrations, all exit 0. `.env` and both storage markers were kept, and the storage link answered 200.
  - The seeded rows in `feature_flags`, `config_versions` and `legal_documents` (24 rows) are **identical** to those of the fresh 0.2.0 install of A, so §11 needs no `db:seed`.
  - All 32 smoke rows passed. The doctor showed `No blockers, 4 warning(s)` (Cron heartbeat, as in A, plus Mail, Pusher and Response flush), and "Search projection" was OK.
- **Not run:**
  - Anything on a real host: TLS and the HTTP-to-HTTPS redirect (no certificate here, so `SESSION_SECURE_COOKIE`, `FORCE_HTTPS` and `curl -I http://…` are unproven).
  - A member registration with mail, a photo or chat-photo upload, a test report through `/melden` with its confirmation mail, a data export, Pusher, push, Turnstile, and the real cron entry over time.
  - `/docs/api` with `APP_ENV=production`, and a browser pass over `public/app`.
  - A real host run follows in M3.9.
