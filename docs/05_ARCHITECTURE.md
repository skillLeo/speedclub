# 05 — Architecture, Stack, API & Deployment

## 1. Decisions in one paragraph
One **Expo (SDK 58 / React Native 0.88) universal app** for iOS, Android **and the member web** (static SPA export served by Laravel at `/app` — same components, therefore the "100 % same interface"). One **Laravel 13** application that provides the **REST API** (`/api/v1`, Sanctum), the **super-admin portal** (Inertia v3 + Vue 3 + TypeScript + Tailwind v4, `/admin`), the **server-rendered public pages** (Blade: landing, `/c/{code}`, `/v/{slug}`, `/u/{username}`, legal) and hosts the SPA. Production runs **only PHP + MySQL on shared hosting**: database queue driven by cron, Pusher Channels for realtime (polling fallback), Expo Push API for notifications, GD for images. **Node is used only on the developer PC** (Expo, Vite builds, Playwright). Full rationale: `DECISIONS.md`.

## 2. Versions (verified November 2026 — re-check installed versions with `npx expo --version`, `php artisan --version` and record in HANDOFF)
| Item | Version / note |
|---|---|
| Expo SDK | 58 (React Native 0.88, React 19.x, New Architecture + Hermes mandatory). Create with `--template default@sdk-58`. Expo Go only supports SDK 58 → we use **development builds / release builds**, never Expo Go |
| Expo Router | v58 (file routes, typed routes, headless tabs `expo-router/ui`) — set `web.output: "single"` (templates default to `"server"`, which needs Node hosting) and `experiments.baseUrl: "/app"` |
| Reanimated / Worklets / Gesture Handler | Reanimated 4.x (+ react-native-worklets) · RNGH 3.x — install only with `npx expo install` |
| Android | compileSdk/targetSdk 36 (Play requires API 36 since 31 Aug 2026); 16 KB page-size compliance for Play updates from 1 Feb 2027; R8 minify on in release (keep rules if a library uses reflection) |
| Laravel | 13.x (PHP ≥ 8.3; we develop on 8.4/8.5 and set `composer config platform.php 8.3.0` so production on 8.3 still works) |
| Inertia | v3 (`inertiajs/inertia-laravel` ^3, `@inertiajs/vue3` ^3; no Axios dependency) |
| Vue / Tailwind | Vue 3.5+ · Tailwind v4 (`@tailwindcss/vite`, CSS-first `@theme`) |
| Laravel AI SDK | `laravel/ai` (stable) — provider-agnostic, fakes for tests |
| DB | Local XAMPP MariaDB 10.11; production MySQL 8.0+ or MariaDB 10.6+ (Laravel supports MariaDB 10.3+/MySQL 5.7+, but use ≥ 10.6/8.0). Write SQL that runs on both (no MySQL-only ngram parser, no JSON_TABLE) |
| Node (dev only) | 22.13+ / 24.3+ / 26+ (even majors only), JDK 17 for Android builds |

## 3. Workspace map (`C:\xampp\htdocs\speedclub\`)
```
speedclub/
├─ README.md · .gitignore · .gitattributes
├─ docs/               01_CLIENT_BRIEF … 08_LEGAL · DECISIONS.md · DEPLOY.md · guides · api/openapi.json
├─ design/             tokens/tokens.json · scripts/build-tokens.mjs · brand/ (client logo files) · icons/auto/*.svg · seed-photos/ (+ CREDITS.md)
├─ mobile/             Expo app (iOS, Android, web export)
├─ web/                Laravel 13 (API, admin, public pages, hosts /app)
├─ scripts/            build-apk.ps1 · verify.ps1 · package-web.ps1 (P3) · templates/
└─ releases/           (gitignored) android/*.apk + .sha256 · web/*.zip · RELEASES.md is committed in docs/
```

## 4. Environments & URL map
| Env | Web/API base | How |
|---|---|---|
| local | `http://localhost:8080` | XAMPP Apache vhost on port 8080 → `web/public` (fallback: `php artisan serve --host=0.0.0.0 --port=8080` with `PHP_CLI_SERVER_WORKERS=8`) |
| lan | `http://<PC-LAN-IP>:8080` | same server reached from phones on the same Wi-Fi; APK built with `-Target lan` (cleartext allowed **only** in lan builds) |
| staging | `https://staging.<client-domain>` | shared host subdomain; client demo; APKs `-Target staging` |
| production | `https://<client-domain>` (placeholder `speedclub.de`) | shared host |

| Path | Served by | Notes |
|---|---|---|
| `/` | Blade WEB-03 | landing |
| `/app`, `/app/*` | Laravel → `public/app/index.html` (no-cache); static assets served directly by Apache | Expo web SPA |
| `/c/{code}`, `/C/{code}` | Blade WEB-01/06 | resolve → 302 `/v/{slug}` or state page; counts scan |
| `/v/{slug}` · `/u/{username}` | Blade WEB-01 · WEB-02 | SSR + OG + JSON-LD; logged-in web users redirected to `/app/v/…` |
| `/impressum` `/datenschutz` `/agb` `/community-richtlinien` `/konto-loeschen` `/app-laden` `/email/{action}` `/melden` `/kontakt` | Blade | |

Every public Blade route above sits in the session-free group of `routes/web.php` (`App\Http\PublicPages`, ADR-115): guests get no cookie and no session row. Form pages decide their CSRF protection separately.

| Path | Served by | Notes |
|---|---|---|
| `/api/v1/*` | API | JSON |
| `/broadcasting/auth` | Laravel | `auth:sanctum` |
| `/admin/*` | Inertia | staff guard, own cookie `sc_staff_session` (path `/admin`), optional IP allow-list / `ADMIN_DOMAIN` |
| `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association` | Laravel | from env (package, SHA-256 cert fingerprints, team id) |
| `/up` | Laravel health | |
| `/docs/api` | Scramble | local/staging only (staff-only in production) |

## 5. Laravel application structure (conventions)
```
web/app/Actions/<Domain>/…        one public method per class (CreateVehicle, PublishVehicle, ReissueQrCode, SendMessage…). All business logic lives here.
web/app/Enums/…                   PowerUnit, PowerSource, VehicleStatus, Visibility, ModStatus, LegalStatus, ConversationFolder, ReportReason, ErrorCode…
web/app/Http/Controllers/Api/V1/<Domain>/   thin: authorize → validate (FormRequest) → Action → Resource
web/app/Http/Controllers/Admin/<Module>/    Inertia::render(…) + spatie/laravel-query-builder for tables
web/app/Http/Controllers/Web/                Blade public pages, SPA host, well-known files
web/app/Http/Middleware/                     Idempotency, ETag, SetLocaleFromHeader, SecurityHeaders, StaffSession (cookie name/path before StartSession), EnsureStaffTwoFactor, EnsureNotRestricted, AdminIpAllowlist
web/app/Http/Requests/{Api/V1,Admin}/…      every input validated here
web/app/Http/Resources/V1/…                 every output shaped here (never return models)
web/app/Models/…  web/app/Policies/…        every model has a policy; controllers call $this->authorize / Gate
web/app/Services/{Media,Qr,Audit,Search,Push,Realtime,AppConfig,Ai,Share}/…
web/app/Support/{Units,Codes,Slug,Blurhash,Html}/…
web/config/speedclub.php          limits, reserved usernames, defaults, flag defaults, catalogue options
web/routes/api.php                requires routes/api/v1/*.php (one file per domain: auth, me, catalog, vehicles, media, mods, qr, social, feed, search, messages, notifications, safety, config, ai)
web/routes/admin.php              loaded with prefix "admin", middleware ['web','staff'] (one file per module under routes/admin/)
web/routes/web.php                public Blade + SPA host + well-known
web/routes/channels.php · routes/console.php (schedule)
web/database/seeders/             CatalogSeeder (makes/models/generations), ModCategorySeeder (+field schemas), BrandSeeder, LegalDocumentSeeder (drafts), StaffSeeder (owner account from env), DemoSeeder (members, vehicles with seed photos, mods, conversations) — DemoSeeder never runs in production
web/lang/{de,en}/…                server strings, validation (German via laravel-lang), emails, admin UI (JSON for laravel-vue-i18n)
web/resources/views/{public,emails,pdf,components}/… · resources/views/app.blade.php (Inertia root)
web/resources/js/admin/{app.ts,Layouts,Pages,Components,composables,lib}/… · resources/js/public/*.ts · resources/js/shared/tokens.generated.ts
web/resources/css/{tokens.generated.css,tailwind-theme.generated.css,admin.css,public.css}
web/tests/{Feature,Unit,Arch}/… (Pest) · web/tests/e2e/… (Playwright: flows, visual, a11y, dom-audit, parity)
```
Rules: controllers ≤ ~40 lines; DB writes inside `DB::transaction` when touching > 1 table; every state-changing admin action and every member security event calls `Audit::record(...)`; no `env()` outside `config/`; enums instead of strings; `HasUlids` for all user-content tables; soft deletes for users, vehicles, mods, media, messages.

## 6. Data model (MySQL/MariaDB, utf8mb4_unicode_ci; all user-content PKs are ULIDs)
**Identity:** `users`(id, email unique lowercased, email_verified_at, password, username unique lowercased, previous_username, username_changed_at, display_name, city, bio, avatar_media_id, cover_media_id, locale, theme, power_display, who_can_message, discoverable, indexable, show_owner_on_qr, read_receipts, notification_prefs json, two_factor_secret enc, two_factor_recovery_codes enc, two_factor_confirmed_at, status, restrictions json, force_password_change, last_seen_at, terms_version, privacy_version, consented_at, marketing_consent_at, deletion_requested_at, deleted_at) · `personal_access_tokens` (+ device_name, platform, app_version, expires_at) · `sessions` · `verification_codes`(user_id/email, purpose, code_hash, attempts, expires_at, consumed_at) · `push_tokens`(user_id, token, platform, device_id, last_used_at).
**Social:** `follows`(follower_id, followee_id, unique) · `blocks`(blocker_id, blocked_id, unique) · `saves`(user_id, vehicle_id, unique).
**Catalogue:** `makes`(name, slug, country, is_popular, sort, active) · `vehicle_models`(make_id, name, slug, active) · `generations`(model_id, name, year_from, year_to, slug) · `brands`(name, slug, category_hint, aliases json, merged_into_id) · `mod_categories`(key, name json, icon, sort, active) · `mod_category_fields`(category_id, key, label json, type, unit, min, max, step, options json, required, searchable, facet, sort) · `catalog_requests`.
**Garage:** `vehicles`(id, owner_id, public_id char(8) unique, slug, status, visibility, is_main, sort, nickname, description, color, cover_media_id, make_id, model_id, generation_id, make_text, model_text, model_year, hu_au_due, published_at, archived_at, deleted_at) · `vehicle_specs`(vehicle_id PK, engine_code, engine_text, displacement_cc, fuel, aspiration, power_value, power_unit, power_source, power_ps (normalised, indexed), torque_nm, torque_source, drivetrain, gearbox) · `modifications`(id, vehicle_id, category_id, title, brand_id, brand_text, part_name, part_number, status, installed_on, cost_cents, cost_public, legal_status, notes, fields json, sort, deleted_at) · `media`(id, owner_id, mediable_type, mediable_id, disk, original_path (private), variants json, width, height, blurhash, focal_x, focal_y, alt, category, sort, status, moderation_status, ai_tags json, deleted_at) · `build_updates`(id, vehicle_id, type, payload json (before/after), note, hidden, created_at).
**QR:** `qr_codes`(id, vehicle_id, code char(8) unique, status, revoked_at, revoked_reason) · `qr_scan_daily`(qr_code_id, day, count, unique pair).
**Messaging:** `conversations`(id, created_by, vehicle_id, last_message_at) · `conversation_participants`(conversation_id, user_id, folder, accepted_at, last_read_message_id, last_read_at, unread_count, muted_until, muted_indefinitely (ADR-210), pinned_at, archived_at, deleted_at) · `messages`(id, conversation_id, sender_id, type, body, media_id, vehicle_id, created_at, deleted_at) · `message_hidden`(message_id, user_id) · `message_reactions`(message_id, user_id, reaction).
**Notifications:** Laravel `notifications` table + `group_key` column.
**Safety & support:** `reports` · `moderation_cases`(status, priority, ai_score, ai_summary, assigned_staff_id) · `decisions`(action, restriction json, statement_of_reasons json {facts, ground, automated, redress}, notified_at) · `appeals` · `support_tickets` · `ticket_messages` · `macros`.
**Admin & platform:** `staff` (+ spatie `roles`/`permissions` with guard `staff`) · `approval_requests` · `audit_events`(id bigint, occurred_at, actor_type, actor_id, action, target_type, target_id, before json, after json, reason, request_id, prev_hash, hash) · `audit_event_access`(audit_event_id, ip, user_agent, occurred_at; staff only, purged after 12 months, ADR-113) · `audit_chain_head`(last_event_id, hash, archived_through_id, archived_hash) · `config_versions`(key, version, status, payload json, created_by, published_by, published_at, reason) · `feature_flags`(key, enabled, rules json, description) · `legal_documents`(key, locale, version, body_md, published_at) · `help_articles` · `gdpr_requests` · `data_exports` · `plans` / `entitlements` / `user_entitlements` (flagged scaffold) · Laravel `jobs`, `job_batches`, `failed_jobs`, `cache`, `cache_locks` · spatie health history.
**Search projection:** `vehicle_search`(vehicle_id PK, owner_id, make_id, model_id, generation_id, model_year, power_ps, drivetrain, gearbox, fuel, wheel_diameter, wheel_brand_id, suspension_type, suspension_brand_id, exhaust_brand_id, mod_category_mask, search_text FULLTEXT, is_public, published_at, updated_at, rank_score) — rebuilt by a job after any vehicle/spec/mod/media change.
Indexes: every FK; `vehicles(owner_id, status, visibility)`, `vehicle_search(make_id, model_id, generation_id)`, `(power_ps)`, `(model_year)`, `(rank_score)`, FULLTEXT `(search_text)`; `messages(conversation_id, id)`; `conversation_participants(user_id, folder, last_message_at)`.

## 7. API conventions (`/api/v1`)
- JSON only; locale from `Accept-Language` (de default).
- **Auth modes:** native → `Authorization: Bearer <Sanctum token>` (one token per device, `expires_at` 90 days, rotated by `POST /auth/token/rotate` when > 7 days old); web SPA (same origin `/app`) → Sanctum **stateful cookie** session + XSRF (`GET /sanctum/csrf-cookie`). The same login endpoint issues a token for native clients (`device_name` present) and a session for the SPA.
- **Responses:** `{ "data": … }`; collections `{ "data": [...], "meta": { "next_cursor": "...", "count": n? }, "links": {…} }` with **cursor pagination** everywhere.
- **Errors:** `{ "message": "<translated>", "code": "<machine_code>", "errors": { "field": ["…"] } }`; 401 unauthenticated, 403 forbidden/restricted (`code: account_restricted`), 404, 409 conflict, 422 validation, 423 maintenance, 426 upgrade required, 429 rate limited (`Retry-After`).
- **Idempotency:** creating POSTs (uploads, messages, vehicles, reports) accept `Idempotency-Key`; replays return the first response for 24 h.
- **Caching:** `ETag` + `If-None-Match` on app-config, catalogue, public vehicle/member resources.
- **OpenAPI:** Scramble generates the spec; `php artisan scramble:export --path=../docs/api/openapi.json` → `npm --prefix mobile run api:types` (openapi-typescript) → `mobile/src/api/schema.d.ts`; the client uses `openapi-fetch` (typed paths). Never hand-write response types.

| Group | Endpoints (summary) |
|---|---|
| Auth | `POST auth/register`, `auth/login`, `auth/logout`, `auth/email/verify`, `auth/email/resend`, `auth/password/forgot`, `auth/password/reset`, `auth/two-factor/challenge`, `auth/token/rotate`; `GET auth/me`; `GET usernames/check` |
| Me | `GET/PATCH me/profile`, `POST me/avatar`, `POST me/cover`, `PUT me/username`, `GET/PATCH me/settings`, `GET me/sessions`, `DELETE me/sessions/{id}`, `POST me/two-factor` (enable), `POST me/two-factor/confirm`, `DELETE me/two-factor`, `POST me/two-factor/recovery-codes`, `POST me/password`, `POST me/email`, `POST me/export`, `GET me/exports`, `POST me/delete`, `POST/DELETE me/push-tokens`, `GET me/blocks` |
| Catalogue | `GET catalog/makes`, `catalog/makes/{make}/models`, `catalog/models/{model}/generations`, `catalog/brands?category=`, `catalog/mod-categories` (with field schemas); `POST catalog/requests` |
| Vehicles | `GET me/vehicles`, `POST vehicles` (draft), `GET/PATCH/DELETE vehicles/{id}`, `PUT vehicles/{id}/specs`, `POST vehicles/{id}/publish`, `POST vehicles/{id}/main`, `PUT me/vehicles/order`, `PATCH vehicles/{id}/visibility`, `GET vehicles/{id}/updates`, `POST vehicles/{id}/updates` (note), `PATCH updates/{id}` (hide) |
| Media | `POST vehicles/{id}/media` (multipart), `PATCH media/{id}` (alt, focal, category, blur regions), `PUT vehicles/{id}/media/order`, `DELETE media/{id}` |
| Mods | `GET/POST vehicles/{id}/mods`, `GET/PATCH/DELETE mods/{id}`, `PUT vehicles/{id}/mods/order`, `POST mods/{id}/media` |
| Public | `GET public/vehicles/{slug}` + `/mods/{id}`, `/updates`, `/updates/{id}`, `GET public/users/{username}`, `GET public/users/{username}/vehicles`, `GET qr/{code}` (resolve) |
| QR | `GET me/qr-codes`, `GET vehicles/{id}/qr`, `GET vehicles/{id}/qr.{svg,png,pdf}`, `POST vehicles/{id}/qr/reissue`, `GET vehicles/{id}/qr/stats` |
| Social | `POST/DELETE users/{username}/follow`, `GET users/{username}/followers`, `…/following`, `DELETE me/followers/{username}`, `POST/DELETE users/{username}/block`, `POST/DELETE vehicles/{id}/save`, `GET me/saved` |
| Feed & discover | `GET feed?tab=for_you|following`, `GET discover` (collections, popular mods, make tiles), `GET search/vehicles`, `GET search/users`, `GET search/facets`, `GET makes/{slug}`, `GET models/{slug}/builds`, `GET vehicles/{id}/similar` |
| Messaging | `GET conversations?folder=chats|requests`, `POST conversations`, `GET conversations/{id}`, `GET conversations/{id}/messages`, `POST conversations/{id}/messages`, `POST conversations/{id}/read`, `POST conversations/{id}/accept`, `POST conversations/{id}/decline`, `PATCH conversations/{id}` (mute/pin/archive), `DELETE conversations/{id}`, `DELETE messages/{id}` (for me), `POST/DELETE messages/{id}/reactions`, `POST conversations/{id}/typing` |
| Notifications | `GET notifications`, `POST notifications/read-all`, `PATCH notifications/{id}`, `GET notifications/unread-count` |
| Safety | `POST reports`, `GET me/reports`, `GET decisions/{id}`, `POST decisions/{id}/appeal`; `POST support/tickets` |
| Config & content | `GET app-config` (ETag), `GET legal/{key}`, `GET help` |
| Share | `GET vehicles/{id}/share-card.{png}?format=story|square`, `GET vehicles/{id}/placard.pdf?size=a5|a4` |
| AI (flags) | `POST ai/search-parse`, `POST ai/mod-suggest`, `POST ai/translate`, `POST ai/describe` |

## 8. Authentication & authorisation
- **Members** (`users`, guard `web` for SPA sessions + Sanctum tokens for native): custom controllers (not Fortify) implementing §3.1 of the product spec; TOTP via `pragmarx/google2fa`; abilities: `member`.
- **Staff** (`staff` table, guard `staff`): **Laravel Fortify** configured with `guard = staff`, `prefix = admin`, `views = false` (the Inertia pages are registered as own routes such as `admin.login`, because Fortify registers no view routes when `views` is false), features: two-factor (confirm required), password reset, update passwords. Middleware `EnsureStaffTwoFactor` forces enrolment (ADM-03). Sensitive actions require `password.confirm` (recent within 5 min) and/or four-eyes approval. Separate session cookie `sc_staff_session` with path `/admin` set by `StaffSession` middleware before `StartSession`.
- **RBAC:** spatie/laravel-permission (guard `staff`), permission atoms and roles in `06_ADMIN_SPEC.md`. Policies check atoms; Inertia shares the current staff's permission list for UI gating (UI gating never replaces server checks).
- **Restrictions:** `EnsureNotRestricted:messaging|publishing` middleware returns 403 `account_restricted` with until-date.

## 9. Media pipeline (shared-hosting safe)
1. Client: pick photos (expo-image-picker / file input / drag-drop) → convert HEIC → JPEG → resize to ≤ 2560 px long edge, quality 0.85 (expo-image-manipulator; canvas on web) → upload queue (concurrency 2, retry with backoff, survives app restarts).
2. Server (`POST vehicles/{id}/media`, multipart, Idempotency-Key): validate size (≤ 15 MB), MIME by content sniffing; **re-encode** with the Laravel Image facade (GD driver): `orient()` → strip all metadata (re-encode drops EXIF/GPS) → store original-sized JPEG privately → WebP variants **320/640/1080/1600** (`cover` for fixed-ratio crops is done at render time with focal point, variants keep aspect) → compute **blurhash** (kornrunner/blurhash on a 32-px thumbnail) → status `ready`. Runs in-request (≈ 1–2 s); on failure, a queued retry.
3. Delivery: public disk (`storage/app/public/media/…` via `storage:link`, or S3-compatible EU bucket if configured) with long-cache headers (`immutable`, file names contain a hash).
4. Plate blur ([SIGNATURE]): client sends normalised rectangles → server pixelates those regions on the original and regenerates variants; the unblurred original is discarded.
5. Limits & cleanup: orphaned uploads pruned after 24 h; deleted media hard-deleted after 30 days.

## 10. Search
`vehicle_search` projection + **query understanding**: split the query, match tokens against the catalogue dictionary (makes, models, generations, brands, aliases; e.g. "M4" → model BMW M4, "R34" → generation, "KW" → suspension brand) → convert to structured filters (shown to the user as chips). Remaining tokens ≥ 3 chars → `MATCH(search_text) AGAINST('+token*' IN BOOLEAN MODE)`; shorter tokens → `LIKE`. Facets = grouped counts on the filtered set (cached 60 s). Members: `users` username/display name/city prefix match + vehicle makes. Upgrade path: Meilisearch Cloud (hosted) later without changing the API.

## 11. Realtime, push, email, queue & cron
- **Realtime:** Laravel broadcasting → **Pusher Channels (EU cluster)**; private channels `private-user.{id}` (inbox/notification counters) and `private-conversation.{id}` (messages, read, typing via client events/whisper). Message events use `ShouldBroadcastNow` (no cron delay). Clients: `laravel-echo` + `pusher-js` (React Native build uses NetInfo). **If Pusher keys are absent or the socket drops → polling** (3 s open conversation, 15 s inbox, paused in background).
- **Push:** Expo Push API (`https://exp.host/--/api/v2/push/send`, batches of 100) from the server; message pushes dispatched **after response** (`dispatch()->afterResponse()`), others via queue; receipts job prunes invalid tokens. Requires an Expo project id + FCM V1 credentials uploaded to Expo (owner action) — without them push is disabled gracefully.
- **Email:** SMTP (host mail or EU provider). Auth codes are sent synchronously; everything else queued. Branded minimal light templates (logo, one column, `de` default).
- **Queue:** `QUEUE_CONNECTION=database`; cron `* * * * * cd /path/to/speedclub && php artisan schedule:run >> /dev/null 2>&1`; `Schedule::command('queue:work --stop-when-empty --max-time=50 --tries=3')->everyMinute()->withoutOverlapping()`. Schedule also: prune tokens/codes/idempotency keys (hourly), hard-delete accounts/media (daily), audit export + verify (daily 02:00), audit retention (daily 02:30), backups (daily 03:30), push receipts (15 min), HU/AU reminders (daily 09:00), saved-builds digest (weekly), sitemap (daily), health checks (5 min), cron heartbeat (every minute).
- **Cache/session:** database stores (no Redis on shared hosting).

## 12. Config, flags, branding (runtime-changeable without a release)
`GET /api/v1/app-config` (ETag, polled on start + every 5 min in foreground) returns: `min_version{ios,android}`, `latest_version`, `maintenance{enabled,message}`, public `flags`, `branding{logo, splash_image, welcome_hero, accent_set, default_theme}`, `announcements`, `legal_versions`, `links`. Clients **cache the last good config** and ignore payloads that fail schema validation. Admin edits go through `config_versions` (draft → preview → publish with reason → rollback). Needs a release: new screens, navigation changes, native splash/app icon, fonts, new permissions.

## 13. Audit log (append-only, tamper-evident)
`Audit::record(action, target, before, after, reason)` → row with `hash = sha256(prev_hash || canonical_json(row))`. No update/delete paths in code; try DB triggers that reject UPDATE/DELETE (skip silently if the host forbids TRIGGER). `php artisan audit:verify` walks the chain (scheduled daily, result on ADM-44/48). Daily JSONL export to private storage (included in backups). `php artisan audit:retention` (daily) applies 06_ADMIN_SPEC §4: purges staff access data, moves expired events to private archive files from the front of the chain and keeps the last hash as checkpoint, deletes expired files (ADR-113). Logged: every staff action (incl. views of sensitive data and view-as), member security events, moderation decisions, config publishes, role changes, exports.

## 14. Internationalisation
Mobile: i18next + react-i18next, **one namespace per feature** (`src/i18n/locales/{de,en}/{common,auth,home,discover,garage,vehicle,qr,messages,profile,settings,safety,errors}.json`) so parallel workstreams never edit the same file; ICU-style plurals; `de` default, device language for first launch. Server: `lang/{de,en}` (German validation via `laravel-lang`), admin UI strings as JSON for `laravel-vue-i18n`. Missing-key test fails the build.

## 15. Security baseline (OWASP MASVS v2 for the app, ASVS L2-lite for the server)
Tokens in SecureStore (native) / httpOnly cookies (web); no secrets in the app bundle (only public keys: Pusher key, API URL). HTTPS everywhere except LAN builds. Rate limits per §8 of the product spec. Strict input validation + output encoding; Markdown rendered with CommonMark safe mode. Uploads re-encoded. Policies on every model; authorisation tests for every endpoint (owner, other member, guest, restricted, staff role). CSP (spatie/laravel-csp, nonces) on Blade/admin; tight CSP for `/app` (self + hashes). Security headers middleware. Staff: mandatory TOTP, re-auth, four-eyes, IP allow-list option, separate cookie. Passwords argon2id when available. Dependency audit (`composer audit`, `npm audit --omit=dev`) in the verify gate. Secrets only in `.env` (never committed). Logs never contain passwords, tokens, message bodies or full emails.

## 16. Mobile app structure
```
mobile/app.config.ts · eas.json · version.json · plugins/withReleaseSigning.js · metro.config.js · babel.config.js
mobile/src/app/…                 routes only (thin) — see 04_SCREEN_REGISTER.md §2
mobile/src/features/<domain>/…   screen bodies, feature components, hooks, zod schemas (auth, home, discover, garage, vehicle, qr, messages, profile, settings, safety)
mobile/src/ui/…                  design-system primitives & components (+ icons/auto)
mobile/src/theme/…               tokens.generated.ts, ThemeProvider, useTheme(), createStyles()
mobile/src/api/…                 client.ts (openapi-fetch, auth modes, idempotency, error mapping), schema.d.ts (generated), queries/*.ts (TanStack Query hooks + keys), realtime.ts
mobile/src/state/…               zustand: session, uploadQueue, prefs
mobile/src/lib/…                 units.ts (PS/kW/hp), format.ts (de-DE numbers/dates), image.ts, storage.ts, haptics.ts, platform.ts, errors.ts
mobile/src/i18n/…                index.ts + locales/{de,en}/*.json
mobile/tests/… (Jest + RNTL) · mobile/e2e/maestro/*.yaml
```
Data: TanStack Query (+ AsyncStorage persister for offline reads), optimistic follow/save/send, invalidation by query keys. Forms: React Hook Form + Zod; server 422 → field errors. Lists: FlashList. Images: expo-image (blurhash placeholder, `contentPosition` from focal point, width-matched variant). Keyboard: react-native-keyboard-controller. Sheets/dialogs: **own `Sheet`/`Dialog` primitives on Reanimated 4 + RNGH 3** (identical on web; no third-party sheet library). Identifiers: name "SPEED CLUB", scheme `speedclub`, bundle/package `de.speedclub.app` (placeholder — confirm before the first store upload), iOS `supportsTablet: false` in V1, Android predictive back on, portrait.

## 17. Admin frontend
Inertia v3 + Vue 3 `<script setup lang="ts">` · Reka UI primitives wrapped as source-owned components in `resources/js/admin/Components/ui` (styled only with tokens) · TanStack Vue Table (server-side mode) · vue-sonner toasts · Chart.js via vue-chartjs (themed from CSS variables) · @phosphor-icons/vue · laravel-vue-i18n · Ziggy `route()` · @vueuse/core. Layout: sidebar 248 + top bar (search, ⌘K, env badge). Shared Inertia props: staff, permissions, flash, locale, env.

## 18. Public Blade pages
`resources/views/public/*` + Blade components mirroring the RN components (spec-strip, vehicle-card, mod-row, owner-row, button variants) using `tokens.generated.css` + `public.css` (Tailwind with reset palette). Inline head script sets `data-theme` (default `system`). < 10 KB JS (gallery swipe, "Mehr anzeigen", share). OG image = server-generated 1200×630 JPEG. JSON-LD `Vehicle` + `BreadcrumbList`. `noindex` when the owner disabled search engines.

## 19. Deployment to shared hosting
**Host requirements:** PHP ≥ 8.3 (8.4/8.5 preferred) with ctype, curl, dom, exif, fileinfo, filter, gd (WebP + FreeType), intl, mbstring, openssl, pdo_mysql, session, sodium, tokenizer, xml, zip; MySQL 8 / MariaDB ≥ 10.6; **SSH + cron**; HTTPS; document root pointing at `public/` (or a subdomain docroot); `memory_limit ≥ 256M`, `upload_max_filesize ≥ 20M`, `post_max_size ≥ 25M`, `max_execution_time ≥ 60`; outbound HTTPS allowed (Pusher, Expo, SMTP, AI).
**Build (dev PC, Phase 3 `scripts/package-web.ps1`):** tokens → `npm --prefix web run build` → `npm --prefix mobile run export:web` (copies to `web/public/app`) → `composer install --no-dev -o` in a clean copy → zip without `.env`, `node_modules`, `tests`, logs.
**Server:** upload → unzip outside `public_html` → point docroot to `…/public` → create `.env` from `web/.env.production.example` → `php artisan key:generate` (first deploy only) → `php artisan down` → `php artisan migrate --force` → `php artisan storage:link` → `php artisan optimize` → `php artisan up` → cron entry → `php artisan speedclub:doctor` (checks extensions, GD WebP, writable dirs, cron heartbeat, mail, Pusher, storage link, queue, search projection: a migration that adds search columns queues a rebuild of every build for the cron worker, and `php artisan search:rebuild` does it at once) → smoke test `/up`, `/`, `/app`, `/admin`.
**Backups:** spatie/laravel-backup (DB + media) daily to a second disk; if the host forbids `proc_open`/`mysqldump`, rely on host backups + weekly manual export (doctor reports it).

## 20. Environment variables (documented in `web/.env.example` and `web/.env.production.example`)
`APP_NAME="SPEED CLUB"`, `APP_ENV`, `APP_KEY`, `APP_DEBUG`, `APP_URL`, `APP_LOCALE=de`, `APP_FALLBACK_LOCALE=en`, `DB_*`, `SESSION_DRIVER=database`, `SESSION_SECURE_COOKIE`, `TRUSTED_HOSTS`, `TRUSTED_PROXIES`, `FORCE_HTTPS`, `SESSION_DOMAIN`, `SANCTUM_STATEFUL_DOMAINS`, `CACHE_STORE=database`, `QUEUE_CONNECTION=database`, `BROADCAST_CONNECTION=pusher|log`, `PUSHER_APP_ID/KEY/SECRET`, `PUSHER_APP_CLUSTER=eu`, `MAIL_*`, `MEDIA_DISK=public|s3`, `AWS_*` (S3-compatible EU), `EXPO_ACCESS_TOKEN` (optional), `AI_PROVIDER`, `ANTHROPIC_API_KEY` (or other provider key), `TURNSTILE_SITE_KEY/SECRET` (optional), `ADMIN_IP_ALLOWLIST`, `ADMIN_DOMAIN` (optional), `STAFF_OWNER_EMAIL` (seeder), `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256` (assetlinks), `IOS_TEAM_ID`, `IOS_BUNDLE_ID`, `STORE_URL_IOS`, `STORE_URL_ANDROID`, `SENTRY_LARAVEL_DSN` (optional), `CORS_ALLOWED_ORIGINS`, `HEALTH_NOTIFICATIONS_ENABLED`, `HEALTH_TO_ADDRESS`.
Mobile (`mobile/.env.*`, only `EXPO_PUBLIC_*`): `EXPO_PUBLIC_APP_ENV` (local|lan|staging|production), `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_PUSHER_KEY`, `EXPO_PUBLIC_PUSHER_CLUSTER`.

## 21. Performance budgets (gates)
Native cold start p75 < 2.0 s (mid-range Android); no dropped-frame bursts > 100 ms while scrolling Home/Discover; JS bundle < 4 MB (Hermes); card images ≤ 120 KB; API p95 < 400 ms on staging; public vehicle page LCP < 2.5 s, INP < 200 ms, CLS < 0.1 (Lighthouse mobile ≥ 90 performance, ≥ 95 accessibility/best-practices/SEO); member web first load < 1.5 MB transferred on `/app` with route-level code splitting (web async routes).
