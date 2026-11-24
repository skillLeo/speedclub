<?php

use Database\Seeders\DemoSeeder;

return [

    // API locales: the first one is the fallback for anything unsupported.
    'locales' => ['de', 'en'],

    'spa' => [
        'index' => public_path('app/index.html'),
    ],

    'staff' => [
        'session_cookie' => 'sc_staff_session',
        'session_path' => '/admin',
        'session_lifetime' => 30, // minutes, 06_ADMIN_SPEC access section
        'owner_email' => env('STAFF_OWNER_EMAIL'),
        // SEC-P3-21: address reveals (member PII, web contacts) per staff member and day.
        'pii_reveals_per_day' => (int) env('STAFF_PII_REVEALS_PER_DAY', 200),
        'ip_allowlist' => array_values(array_filter(array_map(trim(...), explode(',', (string) env('ADMIN_IP_ALLOWLIST', ''))))),
        'domain' => env('ADMIN_DOMAIN'),
        // ADR-215: sensitive admin writes need a password confirmed this recently (middleware staff.recent-password).
        'recent_password_seconds' => 300,
        // ADR-217: a marker cookie that outlives the 30-minute session, so a request after it sees "Deine Sitzung ist abgelaufen".
        // It holds nothing but its own presence and is removed at sign-out.
        'seen_cookie' => 'sc_staff_seen',
        'seen_cookie_minutes' => 720,
        // SEC-P1-26: wrong passwords at the confirmation and the password change, per account. Successes are not counted.
        'password_check_failures' => ['max' => 5, 'minutes' => 15],
        // SEC-P1-34: guesses at two-factor.confirm per account, as the challenge allows.
        'two_factor_confirm_per_minute' => 5,
        // ADR-540: whether staff need TOTP is the governance switch "2FA für Admin-Konten" (ADM-52, Pflicht/Optional, default Optional;
        // App\Services\Governance\Governance). true here forces Pflicht on this deployment whatever the switch says; false (the default)
        // leaves it to the switch. In Optional an account without TOTP signs in without it; steps that read or replace a code stay closed.
        'two_factor_required' => (bool) env('STAFF_2FA_REQUIRED', false),
        // Skips per staff member and minute (route admin.two-factor.skip).
        'two_factor_skips_per_minute' => 5,
    ],

    // Four-eyes engine (ADR-214, 06_ADMIN_SPEC §2).
    'approvals' => [
        'ttl_hours' => 24,
        // An approved audit export is downloadable by its requester for this long, then the file goes (approvals:expire).
        'download_hours' => 24,
        // One export runs inside the approving request on a shared host: a larger one has to be narrowed by its filter.
        'audit_export_max_rows' => 100000,
        'disk_prefix' => 'approvals',
        // SEC-P5-01 (ADR-507): no Owner-Override for this many hours after a staff action took approval rights from someone who held
        // approvals.decide (atoms, roles, deactivation, 2FA reset), so emptying the approver list and overriding is never one sitting.
        'override_cooldown_hours' => 24,
        // The Owner-Override mail also goes to every staff member who approved a request in this many days (besides Owners and Admins).
        'override_alert_approver_days' => 90,
    ],

    // 02_PRODUCT_SPEC §3.1
    'passwords' => [
        'min_length' => 10,
        'max_length' => 255,
        // Lowercased, one per line, every entry at least min_length long, because a shorter one could never match. The most
        // frequent such entries of SecLists Pwdb top 1000000 (MIT) plus German and car terms. ASVS 6.2.4 asks for 3000.
        'common_list' => database_path('data/common-passwords.txt'),
        'common_list_minimum' => 3000,
    ],

    // 05_ARCHITECTURE §7
    'tokens' => [
        'ability' => 'member',
        'expires_days' => 90,
        'rotate_after_days' => 7,
        // Not in the spec (BH-36): how long a replaced token keeps working. The answer to a rotation can get lost after the commit, and
        // then the device holds only the old token. Long enough for its retry, short enough that a copied old token is of little use.
        'rotation_grace_seconds' => 120,
    ],

    // 02_PRODUCT_SPEC §3.1: a login from a device this account has not seen sends a security e-mail.
    'known_devices' => [
        'retention_months' => 12,
        'max_notices_per_hour' => 5,
        // SEC-M47-02: the member web's browser id (KnownDevices::browserFingerprint), first-party, HttpOnly, SameSite=Lax.
        'browser_cookie' => 'sc_browser',
        'browser_cookie_days' => 1825,
    ],

    // M4.7 (09 §8.4, §13): SET-21 rows are kept 12 months; the "Das war ich nicht" link of an alert works this many days.
    'security_events' => [
        'retention_months' => 12,
        'secure_link_days' => 7,
    ],

    // Local-only mail preview (docs/DEPLOY.md §10). Exists only in the environments listed here.
    // Moments inside translated messages. API fields stay ISO 8601 in UTC (App\Support\DisplayDate).
    'display_timezone' => 'Europe/Berlin',

    'dev_mail' => [
        'environments' => ['local', 'testing'],
        'disk' => 'local',
        'directory' => 'dev-mail',
        'keep' => 100,
    ],

    'verification' => [
        'code_length' => 6,
        'expires_minutes' => 10,
        'max_attempts' => 5,
        'resend_cooldown_seconds' => 60,
        'max_codes_per_hour' => 5,
        // Rolling 24 hours per account and purpose. With max_attempts this bounds the guesses at 50 a day (ADR-134).
        'max_codes_per_day' => 10,
        // Codes for someone who just proved the password, counted apart, so that strangers cannot use them up (ADR-140).
        'max_proved_codes_per_day' => 5,
        // What a client running on an old token may spend without anybody asking, per rolling 24 hours (ADR-140).
        'max_background_codes_per_day' => 3,
        // Spent codes stay this long: both limits count them, so never below 24. 06_ADMIN_SPEC §4.
        'retention_hours' => 24,
        // An account nobody proved the address of is removed after this long (ADR-135, privacy policy "Wie lange wir Daten speichern").
        'unverified_account_retention_days' => 7,
        // SEC-P1-51 (M2.8): top-level names no public relay delivers to (RFC 2606, RFC 6761, RFC 6762, ICANN's .internal). DeliverableEmail
        // refuses them for sign-up and the e-mail change. "test" stays open on local and testing hosts, whose demo and e2e accounts live
        // under speedclub.test; unknown environments count as production.
        'reserved_email_tlds' => in_array(env('APP_ENV', 'production'), ['local', 'testing'], true)
            ? ['localhost', 'local', 'invalid', 'example', 'internal']
            : ['localhost', 'local', 'test', 'invalid', 'example', 'internal'],
    ],

    'usernames' => [
        // Client round 2 (2026-11-19): members choose at least 5 characters. Staff (ADM-10) may set 1 to staff_max_length and skip
        // the reserved list; the character rules stay, because the name is part of links and mentions.
        'min_length' => 5,
        'max_length' => 24,
        'staff_max_length' => 40,
        'change_cooldown_days' => 30,
        'old_username_redirect_days' => 14,
        'reserved' => [
            'admin', 'agb', 'api', 'app', 'c', 'datenschutz', 'help', 'hilfe', 'impressum', 'legal',
            'login', 'null', 'official', 'register', 'root', 'settings', 'speedclub', 'staff', 'support',
            'system', 'u', 'undefined', 'v',
        ],
    ],

    // M2.5 SET-12 (08_LEGAL_COMPLIANCE §1: a ZIP within minutes). Built by queued jobs on the private media disk, each well under the
    // worker's 50 s (05_ARCHITECTURE §11): first the JSON, then the photo originals in slices, then the closing directory.
    'data_export' => [
        'link_valid_days' => 7,
        'cooldown_hours' => 24,
        'directory' => 'exports',
        // A photo slice stops after this many photos or seconds, whichever comes first, and queues the next slice.
        'photos_per_job' => 100,
        'job_seconds' => 30,
        // Notifications per JSON file, and conversations (with their messages) per file, read by keyset.
        'chunk' => 500,
        'conversations_per_file' => 50,
        // Fix round (nit 26): all export files on the disk together. Above it a new export waits (503), so a wave of requests cannot fill
        // a shared host's quota.
        'max_total_mb' => 20480,
        // An export still queued or running after this long failed (a killed worker); the member may ask again at once.
        'stuck_after_hours' => 6,
        // Rows stay for the 24 h limit and the status list; the files go when the link expires.
        'keep_rows_days' => 30,
    ],

    // M2.5 SET-13, WEB-05 (02_PRODUCT_SPEC §3.1, 08_LEGAL_COMPLIANCE §1: completed within 30 days).
    'account_deletion' => [
        'hard_delete_after_days' => 30,
        // accounts:prune queues at most this many hard deletes a day; each job purges photos in slices of media_per_job within job_seconds.
        'accounts_per_run' => 200,
        'media_per_job' => 200,
        'job_seconds' => 30,
        // WEB-05: failed credential attempts per account and hour, on top of the per-IP limiter.
        'web_attempts_per_account' => 5,
    ],

    // M2.5 SET-05, AUTH-11. Wrong codes per challenge and per account and minute (the contract's 5); the challenge lives 5 minutes.
    'two_factor' => [
        'challenge_attempts_per_minute' => 5,
        // Fix round (review must-fix 1): wrong second factors per account across challenges, re-checks and WEB-05. Reaching either locks
        // the second factor until a password reset by e-mail code; with 5 a minute alone 7,200 guesses a day were possible.
        'failures_per_hour' => 10,
        'failures_per_day' => 20,
    ],

    // Fix round (review should-fix 5): wrong passwords in re-checks (SET-03 to SET-13) per account and hour, on top of account_security.
    'reauth' => [
        'password_failures_per_hour' => 5,
        // 09 §8.1 "sudo mode": how long POST me/reauth counts for the sensitive endpoints (middleware RequireRecentAuthentication).
        'recent_minutes' => 10,
    ],

    // M4.6 passwordless e-mail code (09 §8.1). Per address: 5 codes an hour, cooldowns 30 → 60 → 120 s between codes, 5 wrong tries per
    // code, 10 failures an hour → a 15-minute lock with a security mail to the account. Per IP the limiter auth-email-start (20 an hour).
    'email_code' => [
        'code_length' => 6,
        'expires_minutes' => 10,
        'max_attempts' => 5,
        'resend_cooldowns' => [30, 60, 120],
        'max_codes_per_hour' => 5,
        'max_failures_per_hour' => 10,
        'lock_minutes' => 15,
        // Not in the spec: how long a code request waits for a parallel one of the same address (named lock) before answering 503.
        'lock_wait_seconds' => 5,
        // Not in the spec: start answers no sooner than this, known address or not, so its duration says nothing (the mail itself
        // leaves after the response, ADR-130).
        'min_response_ms' => 250,
        // Not in the spec: spent rows are kept for the hourly counters, then pruned (speedclub:prune-platform, hourly; privacy policy "Wie lange wir Daten speichern").
        'retention_hours' => 24,
    ],

    // M4.6 Apple and Google ID tokens (ADR-408). Client IDs and keys live in config/services.php.
    'id_tokens' => [
        'jwks_cache_hours' => 6,
        'iat_skew_seconds' => 300,
        'http_timeout_seconds' => 5,
        // A token older than this is refused even when exp is later (Apple issues 10 minutes, Google 1 hour).
        'max_age_seconds' => 3600,
        // SEC-M46-05: server-issued nonces (POST auth/nonce), single use, for Apple and Google.
        'nonce_minutes' => 10,
        // SEC-M46-06: a failed JWKS fetch is not retried for this long; the last good key set keeps working meanwhile.
        'jwks_failure_cache_seconds' => 60,
        // The last good key set stays usable this long after its fetch, so an outage of the provider does not stop sign-ins.
        'jwks_last_good_days' => 7,
    ],

    // M4.6 passkeys for members (09 §8.2, ADR-409, web-auth/webauthn-lib directly). The RP ID is the host of APP_URL unless PASSKEY_RP_ID
    // says otherwise; passkeys made on staging never work on production (expected). Allowed origins: https://{rp host}, the extra origins
    // of PASSKEY_ALLOWED_ORIGINS, and android:apk-key-hash:… derived from ANDROID_CERT_SHA256 (staging and release certificates).
    'passkeys' => [
        'rp_id' => env('PASSKEY_RP_ID') ?: parse_url((string) env('APP_URL', 'http://localhost'), PHP_URL_HOST),
        'rp_name' => 'Speedclub',
        'allowed_origins' => array_values(array_filter(array_map(trim(...), explode(',', (string) env('PASSKEY_ALLOWED_ORIGINS', ''))))),
        'challenge_ttl_seconds' => 300,
        // What the client is told to wait for the authenticator (WebAuthn `timeout`, ms); below the challenge TTL.
        'timeout_ms' => 120000,
        'max_per_member' => 20,
        'name_max_length' => 64,
    ],

    // ADM-61 Mail-Vorschau (09 §8.1): staff-only list of the last 50 outgoing mails. Never in production, whatever this says; the
    // recording listener runs in the same environments.
    'mail_preview' => [
        'enabled' => env('APP_ENV', 'production') !== 'production',
        'limit' => 50,
    ],

    // M2.5 SET-15, WEB-10. Confirmation mails per guest address and day, so the form cannot flood a stranger's inbox.
    'support' => [
        'subject_max_length' => 120,
        'message_max_length' => 5000,
        'guest_confirmations_per_day' => 3,
        // 06_ADMIN_SPEC §4: tickets go 24 months after their last change (support:prune, daily).
        'retention_months' => 24,
    ],

    // M2.5 SET-14.
    'help' => [
        'max_articles' => 100,
    ],

    // 02_PRODUCT_SPEC §3.2
    // M4.11 Social 2.0 (09 §8.5, §8.6).
    'social_2' => [
        // An owner edits a posted update within this many hours; hiding and deleting stay open (09 §8.5).
        'update_edit_hours' => 24,
        'update_text_max' => 2000,
        'update_max_photos' => 10,
        'update_max_mods' => 20,
        // Mentions stored per text; more are left as plain text (no notification), so one post cannot ping a crowd.
        'max_mentions' => 10,
        'mention_suggest_limit' => 8,
        'comment_max' => 500,
        'comments_page_size' => 30,
        'max_highlights' => 8,
        'max_collections' => 50,
        'collection_name_max' => 60,
        'max_collection_items' => 1000,
    ],

    // M5.8 Forum (10 §7, ADR-506, m5.8-contract). Accounts younger than premoderation_days or without a verified e-mail post into
    // pre-moderation. Lengths in characters; tags lower case.
    'forum' => [
        'premoderation_days' => 3,
        'title_max' => 120,
        'opening_max' => 10000,
        'reply_max' => 5000,
        'max_photos' => 6,
        'max_tags' => 5,
        'page_size' => 20,
        'max_page_size' => 50,
        'replies_shown' => 100,
        'similar_max' => 5,
        'active_days' => 14,
        'active_max' => 3,
    ],

    // M4.12 Events and meets (09 §8.7).
    'events' => [
        // Creation rights: verified e-mail, an account at least this old, the event rules accepted.
        'organiser_min_account_days' => 14,
        // The first this-many events of an organiser go to pre-moderation (ADM-53), and every event with an after_rsvp place.
        'premoderate_first' => 2,
        'title_max' => 120,
        'description_max' => 5000,
        'rules_max' => 2000,
        'update_max' => 1000,
        'reason_max' => 500,
        'max_capacity' => 10000,
        // Not in the spec: bounds the drafts and upcoming events of one organiser.
        'max_open_per_organiser' => 20,
        // An event lasts at most this long (a fair over a weekend).
        'max_duration_hours' => 96,
        // How far ahead an event can be planned.
        'max_days_ahead' => 400,
        'list_page_size' => 30,
        'pins_max' => 300,
        'near_default_km' => 50,
        'near_max_km' => 300,
        // Reminders 24 h and 2 h before the start (09 §8.7), sent by events:reminders every five minutes; it stops after this many seconds.
        'reminder_job_seconds' => 40,
        // Security review SEC-412-02: a moved start re-arms a reminder kind only when its new moment is at least this many hours after the
        // last one of that kind, so moving an event back and forth cannot repeat the reminders.
        'reminder_rearm_hours' => 12,
        // Changes of time or place of a published event (each tells every attendee): at most this many per event and hour (not in the spec).
        'changes_per_hour' => 5,
        // Cancelled and rejected events go after 12 months (09 §13 retention), past events after this many months.
        'cancelled_retention_months' => 12,
        'past_retention_months' => 24,
        // ADR-113 (security review note): the exact venue of an after_rsvp event goes this many days after its end.
        'exact_place_retention_days' => 30,
        // A signed calendar link of an attendee works this many days after the event ended.
        'calendar_link_days_after' => 2,
        // M5.6 (m5.6-contract §4, §5): an event without an end counts as lasting this many hours for the gallery and check-in windows.
        'assumed_duration_hours' => 6,
        // The gallery takes uploads from the start until this many days after the end (flag events.gallery).
        'gallery_days' => 14,
        // Photos per event: one attendee (pending included), the organiser, and the whole event. Rejected ones count until deleted.
        'gallery_limits' => ['attendee' => 10, 'organiser' => 40, 'event' => 200],
        // The shorter side of a gallery photo, in pixels, after the app's resize to client_max_long_edge_px.
        'gallery_min_short_side' => 800,
        'gallery_alt_max' => 200,
        'gallery_reason_max' => 200,
        'gallery_page_max' => 50,
        'gallery_page_size' => 30,
        // Approved photos on EVT-02 (newest approval first).
        'gallery_preview' => 6,
        // The files of a photo the organiser turned down go after this many days; the row stays for the uploader's "Abgelehnt".
        'gallery_rejected_purge_days' => 7,
        // Check-in (flag events.checkin): from this many minutes before the start until this many after the end. The code rotates
        // every checkin_code_ttl seconds; the code before stays valid checkin_code_grace seconds longer (a scan in flight).
        'checkin_opens_before_minutes' => 60,
        'checkin_closes_after_minutes' => 120,
        'checkin_code_ttl' => 300,
        'checkin_code_grace' => 60,
        // Wrong codes per member and event in an hour before 429 (on top of throttle:checkins).
        'checkin_wrong_codes_max' => 5,
        'checkins_page_max' => 50,
        'public_checkins_page_max' => 20,
        // M5.6 "Neue Treffen in deiner Nähe" (m5.6-contract §6): weekly, opt-in, around the SET-11 region. events:nearby-digest runs every
        // ten minutes and works only from Thursday 18:00 (Europe/Berlin) for nearby_window_hours, resuming where it stopped; each run stops
        // after nearby_job_seconds. Events published in the last nearby_new_days, starting within nearby_ahead_days, within
        // nearby_radius_km of the region point; the e-mail lists nearby_mail_max of them. The unsubscribe link works nearby_unsubscribe_days.
        'nearby_weekday' => 4,
        'nearby_time' => '18:00',
        'nearby_window_hours' => 16,
        'nearby_job_seconds' => 40,
        'nearby_chunk' => 100,
        'nearby_new_days' => 7,
        'nearby_ahead_days' => 14,
        'nearby_radius_km' => 50,
        'nearby_mail_max' => 5,
        'nearby_unsubscribe_days' => 60,
    ],

    // M4.14 parts catalogue (09 §8.9) and business profiles (09 §8.10, ADR-414).
    'parts' => [
        'page_size' => 30,
        'max_page_size' => 50,
        // "Marken im Fokus" and the Teile scope's brand row: at most this many brands, by their real number of builds.
        'top_brands_max' => 24,
        'query_min' => 2,
        'query_max' => 80,
    ],

    // R4-2.3 Crews (docs/reports/round-4/contract-crews.md §1). Limits from the spec (5 memberships, 2 founded); the rest not in the spec.
    'crews' => [
        'memberships_max' => 5,
        'founded_max' => 2,
        // Open join requests per member and open invitations per crew: bound a member asking everywhere and a crew inviting everybody.
        'open_requests_max' => 10,
        'open_invites_max' => 50,
        'page_size' => 30,
        'max_page_size' => 50,
        'name_min' => 3,
        'name_max' => 40,
        'description_max' => 500,
        // CREW-01: the public builds shown under each member.
        'vehicles_per_member' => 3,
        // A deleted crew keeps its row, logo and cover (private originals only) this long, then crews:prune removes it; never while a
        // moderation case or an appeal about it is open (DSA evidence). A crew staff deleted (status removed) waits for the appeal period.
        'hard_delete_after_days' => 30,
        'removed_retention_days' => 190,
        // Compared with the name's key and its slug: names that would pass for the platform or collide with app paths.
        'reserved_names' => [
            'speedclub', 'speed club', 'admin', 'staff', 'support', 'team', 'offiziell', 'official', 'moderation', 'crews', 'crew', 'neu',
            'new', 'mine', 'me', 'invites', 'requests',
        ],
    ],

    'businesses' => [
        'page_size' => 30,
        'max_page_size' => 50,
        'services_max' => 12,
        'service_max' => 40,
        'about_max' => 2000,
        // Staff of a business besides its owner (not in the spec).
        'members_max' => 10,
        // Pending tag proposals a business may have open at once (not in the spec): bounds a business tagging builds it never touched.
        'open_proposals_max' => 100,
        // SEC-414-03: how long the staff member who verified a business may reopen it (their own undo); later only the four-eyes
        // suspension takes a verified business offline.
        'reopen_window_minutes' => 1440,
        // BIZ-03 "Profilaufrufe": the days summed, and how long the daily numbers are kept.
        'views_days' => 30,
        'views_retention_days' => 400,
        'near_default_km' => 50,
        'near_max_km' => 300,
    ],

    // M4.12 geocoding proxy (09 §8.7, ADR-411): Nominatim (OpenStreetMap) behind the server, search on submit only, 1 request a second
    // for the whole host, 30-day cache. The upstream host is fixed here, never taken from a request (no SSRF). The usage policy needs a
    // descriptive User-Agent with a contact address: GEOCODE_CONTACT_EMAIL (owner action); without it the proxy names the site URL only.
    'geocode' => [
        'provider' => 'nominatim',
        'nominatim_url' => env('GEOCODE_NOMINATIM_URL', 'https://nominatim.openstreetmap.org'),
        'contact_email' => env('GEOCODE_CONTACT_EMAIL'),
        'countries' => env('GEOCODE_COUNTRIES', 'de,at,ch,nl,be,lu,dk,pl,cz,fr'),
        'cache_days' => 30,
        'timeout_seconds' => 5,
        'limit' => 5,
        'query_min' => 3,
        'query_max' => 200,
    ],

    'garage' => [
        'max_vehicles_per_member' => 20,
        'max_photos_per_vehicle' => 30,
        'max_photos_per_modification' => 6,
        // Not in the spec: bounds one build page and the jobs that read it.
        'max_modifications_per_vehicle' => 200,
        'wizard_steps' => 4,
        // Three or more photos within this window are one update (the debounce window below).
        'photos_for_build_update' => 3,
        'build_update_debounce_minutes' => 10,
        // Not in the spec: an open update starts over at this many changes, and lists render no more than this of any entry.
        'build_update_max_changes' => 20,
        'hard_delete_after_days' => 30,
        // How many entries of Verlauf a vehicle page carries; the rest comes through the list route.
        'public_updates_on_page' => 20,
    ],

    // M2.1 social graph: PROF-04 follower lists, SET-08 blocked accounts, PROF-05 saved builds.
    'social' => [
        'page_size' => 30,
        'max_page_size' => 50,
        // The search field of PROF-04.
        'query_max_length' => 64,
    ],

    // Art. 21 DSA: where a member finds the certified out-of-court dispute settlement bodies (statement of reasons, SAFE-01). The
    // default is the European Commission's page on them; the lawyer confirms it (OA-17).
    'legal' => [
        'dispute_settlement_url' => env('DISPUTE_SETTLEMENT_URL', 'https://digital-strategy.ec.europa.eu/en/policies/dsa-out-court-dispute-settlement'),
    ],

    // M2.6 safety (DSA notice and action). Reports 20 a day are rate_limits.reports; WEB-09 shares that limiter, per IP.
    'moderation' => [
        // SET-16 lists (GET me/reports, me/decisions).
        'page_size' => 30,
        'max_page_size' => 50,
        'details_max_length' => 1000,
        'appeal_max_length' => 2000,
        // A message report keeps the reported message and up to this many before and after it (ADM-22 sees only these).
        'message_context' => 5,
        // WEB-09 checks Cloudflare Turnstile when both services.turnstile_* keys are set (App\Services\Support\Turnstile).
        // WEB-09 mails (confirmation of receipt and outcome) to one unverified address per day.
        'guest_mails_per_day' => 3,
        // The address for notices and appeals by e-mail ([[Melde-E-Mail]] of the legal drafts, ADR-116); falls back to SUPPORT_EMAIL.
        'contact_email' => env('MODERATION_EMAIL'),
    ],

    // 05_ARCHITECTURE §9. HEIC is converted to JPEG by the client (02_PRODUCT_SPEC §3.2); GD cannot decode it.
    'media' => [
        'disk' => env('MEDIA_DISK', 'public'),
        'private_disk' => env('MEDIA_PRIVATE_DISK', 'local'),
        // ADR-539: browser cache of /storage/… when PHP serves it (a host without the public/storage link). A day, with ETag and
        // Last-Modified: an OG card regenerated under the same name is seen again the next day at the latest.
        'php_served_max_age' => 86400,
        'max_upload_mb' => 15,
        'allowed_mimes' => ['image/jpeg', 'image/png', 'image/webp'],
        // Measured against the 256M memory_limit: the pipeline peaks at 178 MB for 12 MP and 244 MB for 16 MP, and 20 MP
        // is a fatal error PHP cannot catch. Clients send at most client_max_long_edge_px, about 6.5 MP in 3:2.
        'max_pixels' => 12_000_000,
        'client_max_long_edge_px' => 2560,
        'variant_widths' => [320, 640, 1080, 1600],
        'original_quality' => 90,
        'variant_quality' => 80,
        // M4.18 (LCP budget of the public pages, 2.0 s): the most a WebP variant of each width may weigh. The encoder steps the
        // quality down from variant_quality by variant_quality_step until a variant fits, never below variant_min_quality and never
        // by changing dimensions. The values follow 80 KB at 640 w scaled by (width / 640) ^ variant_budget_exponent, which also
        // gives the budget of an unlisted width (a photo narrower than 1600 px keeps its own width). Typical photos stay at
        // variant_quality: on the demo set the budget only touches those above p90. media:recompress applies it to stored variants.
        'variant_budget_kb' => [320 => 28, 640 => 80, 1080 => 176, 1600 => 316],
        'variant_budget_exponent' => 1.5,
        'variant_min_quality' => 55,
        'variant_quality_step' => 5,
        'blurhash_size' => 32,
        'orphan_prune_hours' => 24,
        // Not in the spec, ADR-146: bytes on the disks per member, public files and private originals. A draft of 30 photos at
        // client_max_long_edge_px takes about 120 MB, 20 vehicles of them about 2.4 GB.
        'quota_mb' => 4096,
        'quota_unverified_mb' => 200,
        'hard_delete_after_days' => 30,
        // Not in the spec (BH-46): how long a failed upload stays for its owner to see on GAR-07 before media:prune removes the row.
        'failed_prune_days' => 30,
    ],

    // 02_PRODUCT_SPEC §8. catalog_requests is not in the spec: it only protects the review queue (ADM-14).
    'rate_limits' => [
        'member_register' => ['max' => 5, 'minutes' => 60],
        'member_login' => ['max' => 10, 'minutes' => 1],
        // Not in the spec: bounds on top of the per-code and per-account limits.
        'member_verify' => ['max' => 30, 'minutes' => 1],
        'member_email' => ['max' => 10, 'minutes' => 10],
        'username_check' => ['max' => 60, 'minutes' => 1],
        'conversations' => ['max' => 20, 'minutes' => 1440],
        'conversation_requests' => ['max' => 10, 'minutes' => 1440],
        'messages' => ['max' => 30, 'minutes' => 1],
        // Not in the spec (M2.4): read marks, accept and decline, organise, delete for me and reactions, per member. A member reading
        // a busy chat sends one read mark per new message; far above that.
        'conversation_edits' => ['max' => 120, 'minutes' => 1],
        // m2.4-contract §2: typing signals, at most one every 3 s.
        'typing' => ['max' => 20, 'minutes' => 1],
        // Not in the spec (M2.4): Pusher channel authorisations; a client authorises two channels per (re)connect.
        'realtime_auth' => ['max' => 60, 'minutes' => 1],
        'follows' => ['max' => 200, 'minutes' => 1440],
        'uploads' => ['max' => 60, 'minutes' => 60],
        'reports' => ['max' => 20, 'minutes' => 1440],
        // 60 per member or guest IP (spec). ip_max is not in the spec: every search reads the keys of every public build, so one
        // address bounds all accounts behind it at four members' worth, far below browse's 1200 (SEC-M18-01).
        'search' => ['max' => 60, 'minutes' => 1, 'ip_max' => 240],
        'qr' => ['max' => 120, 'minutes' => 1],
        'public_read' => ['max' => 300, 'minutes' => 1], // anonymous catalogue, config and legal GETs (ADR-115)
        'client_errors' => ['max' => 10, 'minutes' => 1], // crash reports of the app's error screens (POST /api/v1/client-errors)
        // Not in the spec: Home, Discover and search, which members read signed in. 300 per member, guests per IP; ip_max bounds
        // one address across all accounts behind it (car-meet wifi, carrier NAT) without letting them share one member's bucket.
        'browse' => ['max' => 300, 'minutes' => 1, 'ip_max' => 1200],
        'catalog_requests' => ['max' => 20, 'minutes' => 1440],
        // Not in the spec: vehicles, modifications and notes per member, well above what a person enters.
        'garage_writes' => ['max' => 120, 'minutes' => 60],
        // Not in the spec: a drag saves once per drop.
        'garage_reorders' => ['max' => 60, 'minutes' => 1],
        // Not in the spec: edits, deletes and toggles of the garage; autosave and a long session stay far below it.
        'garage_edits' => ['max' => 600, 'minutes' => 60],
        // Not in the spec: a device rotates about once a week and retries a lost answer a few times; during the grace each call writes a row.
        'token_rotate' => ['max' => 10, 'minutes' => 1],
        // Not in the spec: its own bucket, so undoing a follow does not eat the 200 follows a day.
        'unfollows' => ['max' => 200, 'minutes' => 1440],
        // Not in the spec (M2.1): blocking and unblocking share one bucket; a safety tool, so far above what a person needs.
        'blocks' => ['max' => 100, 'minutes' => 1440],
        // Not in the spec (M2.1): saving and unsaving builds [SIG sig.saved_builds].
        'saves' => ['max' => 300, 'minutes' => 1440],
        // Not in the spec (M4.11): setting and taking back reactions, per member.
        'reactions' => ['max' => 600, 'minutes' => 1440],
        // Not in the spec (M4.11) [build_comments]: comments per member and hour.
        'comments' => ['max' => 30, 'minutes' => 60],
        // Not in the spec (M4.11): @mention suggestions while typing.
        'mention_suggest' => ['max' => 120, 'minutes' => 1],
        // Not in the spec (M4.11): collection and item writes per member.
        'collections' => ['max' => 600, 'minutes' => 60],
        // Not in the spec (M4.11): posting build updates, on top of garage_writes; a mention spammer hits this first.
        'build_updates' => ['max' => 30, 'minutes' => 60],
        // Not in the spec (M4.12): events created per member and day, RSVP changes per member and hour, organiser updates per hour,
        // geocoding searches per member and hour (the upstream itself is held to 1 a second for the host, App\Services\Events\Geocoder).
        'events' => ['max' => 10, 'minutes' => 1440],
        'rsvps' => ['max' => 120, 'minutes' => 60],
        'event_updates' => ['max' => 20, 'minutes' => 60],
        'geocode' => ['max' => 60, 'minutes' => 60],
        // Not in the spec (M4.14): BIZ-02 applications and profile edits per member and hour; tag requests and decisions per member and hour.
        'businesses' => ['max' => 30, 'minutes' => 60],
        'business_tags' => ['max' => 120, 'minutes' => 60],
        // Not in the spec (R4-2.3): crew writes (create, edit, logo/cover, delete, hand-over) and crew actions (join, requests, invitations,
        // members, leave) per member and hour.
        'crews' => ['max' => 30, 'minutes' => 60],
        'crew_actions' => ['max' => 120, 'minutes' => 60],
        // M5.9b STREET DEX (10 §16.2, contract §2): POST spots, 30 per member and hour (the owner's figure).
        'spots' => ['max' => 30, 'minutes' => 60],
        // M5.9e Season Wrapped: "geteilt" marks and server card images (GD) per member and hour; a full story is 9 images.
        'wrapped' => ['max' => 120, 'minutes' => 60],
        // M5.9d: GET invites/{code} and the /join/{code} page, per IP (codes are 8 Crockford characters; this keeps guessing slow).
        'invite_lookup' => ['max' => 30, 'minutes' => 1],
        // Not in the spec (M2.6): appeals against decisions, one per decision anyway; bounds a flood of attempts.
        'appeals' => ['max' => 10, 'minutes' => 1440],
        // M3.7 [AI] (m3.7 contract §1): every AI endpoint but the translation, and the translation, per member and hour.
        'ai' => ['max' => 30, 'minutes' => 60],
        'ai_translate' => ['max' => 60, 'minutes' => 60],
        // Not in the spec (SEC-P1-04): PATCH me/settings and me/profile together, far above autosave.
        'account_edits' => ['max' => 60, 'minutes' => 1],
        // Not in the spec (M2.2): marking notifications read, one or all.
        'notification_reads' => ['max' => 120, 'minutes' => 1],
        // Not in the spec (M2.2): registering and removing push tokens; a device does it at sign-in and on a token change. M4.15: the
        // member web's Web Push subscriptions (POST/DELETE me/push-subscriptions) count here too.
        'push_tokens' => ['max' => 30, 'minutes' => 60],
        // Not in the spec: the PDF takes dompdf a moment, and someone printing stickers downloads a handful.
        'qr_downloads' => ['max' => 30, 'minutes' => 1],
        // Not in the spec: replacing a code kills a printed sticker, so nobody needs this often.
        'qr_reissues' => ['max' => 5, 'minutes' => 60],
        // Not in the spec (M5.4 sticker designer, m5.4-contract §3): autosaves and restores per member (one autosave every few seconds
        // while editing), live previews per member and minute, Scan-Tests (a render and a decode each) and order links per member and hour.
        'sticker_designs' => ['max' => 600, 'minutes' => 60],
        'sticker_previews' => ['max' => 120, 'minutes' => 1],
        'sticker_validations' => ['max' => 30, 'minutes' => 60],
        'sticker_orders' => ['max' => 30, 'minutes' => 60],
        // M5.8 Forum (10 §7.3): threads 5 a day and replies 60 a day per member (the spec); "Hilfreich" votes and taking them back,
        // not in the spec, far above what a reader marks.
        'forum_threads' => ['max' => 5, 'minutes' => 1440],
        'forum_replies' => ['max' => 60, 'minutes' => 1440],
        'forum_votes' => ['max' => 300, 'minutes' => 1440],
        // M5.6 (m5.6-contract §5.3): check-ins per member and hour (POST events/{slug}/checkin); wrong codes have their own limit
        // (events.checkin_wrong_codes_max per event and hour).
        'checkins' => ['max' => 10, 'minutes' => 60],
        // Not in the spec (SEC-P1-02): staff reset-link requests and new-password attempts, each per IP and per address. A
        // throttled link request gets the same neutral answer as any other.
        'staff_password_reset' => ['max' => 5, 'minutes' => 15],
        // Not in the spec (M2.5): re-authenticated security changes per member (e-mail, password, two-factor, sessions, export, deletion).
        // Each checks the password; this bounds guessing with a stolen session far below the login delay.
        'account_security' => ['max' => 10, 'minutes' => 10],
        // M4.6 (09 §8.1): e-mail code starts, 20 an hour per IP; the per-address limits are in email_code.
        'auth_email_start' => ['max' => 20, 'minutes' => 60],
        // Not in the spec: e-mail code verifies and link confirms per IP, on top of 5 tries per code and 10 failures an hour per address.
        'auth_email_verify' => ['max' => 30, 'minutes' => 1],
        // Not in the spec: Apple and Google sign-ins per IP.
        'auth_social' => ['max' => 20, 'minutes' => 1],
        // Not in the spec: passkey sign-in options and verifies per IP.
        'auth_passkeys' => ['max' => 30, 'minutes' => 1],
        // Not in the spec (M4.7): "Das war ich nicht" links per IP; each link works once anyway.
        'auth_secure_account' => ['max' => 10, 'minutes' => 10],
        // Not in the spec: POST me/reauth and its options per member; wrong answers count in their own budgets as well.
        'reauth' => ['max' => 10, 'minutes' => 10],
        // Not in the spec: passkey and provider changes per member.
        'auth_methods' => ['max' => 20, 'minutes' => 60],
        // M2.5 AUTH-11, per IP on top of the 5 a minute per challenge and account inside the action.
        'two_factor_challenge' => ['max' => 10, 'minutes' => 1],
        // Not in the spec (M2.5): SET-15 tickets per member.
        'support_tickets' => ['max' => 5, 'minutes' => 60],
        // Not in the spec (M2.5): WEB-10 /kontakt and WEB-05 /konto-loeschen posts per IP.
        'contact_form' => ['max' => 5, 'minutes' => 60],
        'web_account_deletion' => ['max' => 10, 'minutes' => 15],
        // Client round 6 (L3): WEB-05 deletion codes asked for per IP; the per-address limits (cooldowns, 5 codes an hour, the lock) are
        // in email_code.
        'web_account_deletion_code' => ['max' => 10, 'minutes' => 60],
        // Not in the spec (SEC-P1-53): anonymous GET /sanctum/csrf-cookie per IP (/64 for IPv6), ahead of the session, because each one
        // writes a session row. The member web asks once per sign-in.
        'csrf_cookie' => ['max' => 30, 'minutes' => 1],
        // M5.7 (m5.7-contract §11): POST views per member or guest IP (one per screen focus of VEH-01/PROF-02), with a bound per IP over
        // everybody behind it; GET me/insights and vehicles/{id}/insights per member.
        'views' => ['max' => 60, 'minutes' => 1, 'ip_max' => 300],
        'insights' => ['max' => 60, 'minutes' => 1],
        // Not in the spec (R4-2.1): Car of the Day votes and changes per member and hour; one vote a day counts anyway.
        'cotd_votes' => ['max' => 30, 'minutes' => 60],
    ],

    // M5.4 Sticker (10 §2.3, m5.4-contract §4, §6, §7, §11). Print geometry in mm; the Scan-Test raster in pixels per QR module.
    // shop: the Shopify cart permalink of "Sticker bestellen" (OA-44); without a domain and a variant id for the size the button shows
    // "Bestellung bald verfügbar". The domain is the store's (xyz.myshopify.com or its own), the variant ids are Shopify's numbers.
    'stickers' => [
        'bleed_mm' => 3.0,
        'slug_mm' => 12.0,
        'qr_min_mm' => 25,
        'custom_line_max' => 24,
        'decode_px_per_module' => 4,
        'shop' => [
            'domain' => env('SHOPIFY_STORE_DOMAIN'),
            'variant' => env('SHOPIFY_STICKER_VARIANT'),
            'variants' => [
                's' => env('SHOPIFY_STICKER_VARIANT_S'),
                'm' => env('SHOPIFY_STICKER_VARIANT_M'),
                'l' => env('SHOPIFY_STICKER_VARIANT_L'),
            ],
        ],
    ],

    // M5.5 Shop (10 §3, m5.5-contract §2, §4, §6, ADR-502/524). The store is the one of "Sticker bestellen" (stickers.shop.domain);
    // extra_hosts adds hosts a product URL may use besides it (e.g. the store's xyz.myshopify.com), never a wildcard. driver: local (the
    // ADM-66 catalogue) or shopify (Storefront API, OA-44; a stub until the client gives a token, and local while not configured).
    'shop' => [
        'driver' => env('SHOP_CATALOGUE_DRIVER', 'local'),
        // R4-3.2 (SHOP-01): available | coming_soon per category. A coming_soon chip shows "Bald verfügbar", is not selectable, and its
        // products stay out of every list, count, hero and detail until the client opens it here.
        'categories' => [
            'sticker' => 'available',
            'apparel' => 'coming_soon',
            'accessories' => 'coming_soon',
        ],
        'extra_hosts' => env('SHOP_EXTRA_HOSTS'),
        'page_size' => 20,
        'max_page_size' => 48,
        'max_images' => 8,
        'max_variants' => 24,
        'purge_after_days' => 30,
        'shipping_path' => '/policies/shipping-policy',
        'disk' => env('MEDIA_DISK', 'public'),
        'private_disk' => env('MEDIA_PRIVATE_DISK', 'local'),
        'directory' => 'shop',
        'image' => [
            'max_upload_kb' => 15360,
            // Product photos are cropped to 4:5 on upload; the source must hold a crop of at least this size.
            'product_min' => [1080, 1350],
            'banner_min_width' => 1600,
            // Banner ratio limits (width / height): 4:5 … 21:9.
            'banner_ratio' => [0.8, 2.334],
        ],
        'shopify' => [
            'storefront_token' => env('SHOPIFY_STOREFRONT_TOKEN'),
            'api_version' => env('SHOPIFY_STOREFRONT_API_VERSION', '2026-10'),
            'timeout' => 5,
            'cache_seconds' => 300,
        ],
    ],

    // Progressive delay per account after failed logins, no hard lockout (02_PRODUCT_SPEC §8).
    'login_delay' => [
        'free_failures' => 5,
        'base_seconds' => 2,
        'max_seconds' => 60,
        'window_minutes' => 60,
    ],

    // 05_ARCHITECTURE §7
    'idempotency' => [
        'ttl_hours' => 24,
        // A first request older than this crashed; a retry may take the key over.
        'in_flight_timeout_seconds' => 120,
        'retry_after_seconds' => 2,
        'max_key_length' => 128,
    ],

    'catalog' => [
        'default_page_size' => 200,
        'max_page_size' => 500,
    ],

    // 05_ARCHITECTURE §12: values until a config_versions row of the same key is published (ADM-36).
    'app_config' => [
        'cache_seconds' => 60,
        'remote_config' => [
            // The first release is 0.1.0 (mobile/version.json): anything newer here would force-update every 0.1.x build.
            'min_version' => ['ios' => '0.1.0', 'android' => '0.1.0'],
            'latest_version' => ['ios' => '0.1.0', 'android' => '0.1.0'],
            'maintenance' => ['enabled' => false, 'message' => null],
        ],
        'branding' => [
            'logo' => '/brand/logo-wide-white-640.webp',
            'splash_image' => null,
            'welcome_hero' => null,
            'accent_set' => 'default',
            'default_theme' => 'carbon',
        ],
        'announcements' => [],
        'links' => [
            'imprint' => '/impressum',
            'privacy' => '/datenschutz',
            'terms' => '/agb',
            'community' => '/community-richtlinien',
            'help' => '/kontakt',
            'support_email' => env('SUPPORT_EMAIL', 'support@speedclub.de'),
            'store_ios' => env('STORE_URL_IOS'),
            'store_android' => env('STORE_URL_ANDROID'),
            // M2.7 WEB-04: where SYS-01 sends an app without a store listing (before the launch, a staging build for testers).
            'get_app' => '/app-laden',
            // M4.9 (09 §8.16): the sticker shop the owner runs elsewhere; shown only while the flag sticker_shop is on and this is set.
            'sticker_shop' => env('STICKER_SHOP_URL'),
        ],
    ],

    // M3.5 ADM-28 brand assets and the hero contrast rule (ADR-129, ADR-151, ADR-152, FS-1). Sizes in points of FS-1.
    'brand' => [
        'public_disk' => env('MEDIA_DISK', 'public'),
        'private_disk' => env('MEDIA_PRIVATE_DISK', 'local'),
        'directory' => 'brand/assets',
        'max_upload_kb' => 15360,
        'variant_widths' => [320, 640, 1080, 1600],
        'logo_widths' => [160, 320, 640, 1280],
        'og_size' => [1200, 630],
        'default_accent' => 'signalRed',
        // Written by design/scripts/build-tokens.mjs after its contrast gate; ships with web/.
        'accent_source' => resource_path('js/shared/tokens.generated.ts'),
        'hero_check' => [
            'minimum' => 4.5,
            // A tall and a short phone (portrait); the worst one decides.
            'frames' => ['phone_390x844' => [390, 844], 'phone_360x640' => [360, 640]],
            'logo_top' => 0.28,
            'logo_width_share' => 0.72,
            'logo_max_width' => 320,
            // mobile/assets/brand/logo-wide-white.png is 696 × 184 (client logo of round 3, 2026-11-19).
            'logo_aspect' => 696 / 184,
            // ADR-151: the logo shadow keeps at least 42 % black under every ink pixel.
            'logo_shadow_alpha' => 0.42,
            // overlay.photoScrimEnd rgba(0,0,0,0.72); onPhoto.secondary white at 80 %.
            'scrim_end_alpha' => 0.72,
            'text_alpha' => 0.8,
            // FS-1's bottom block at 100 % font with the safe inset, and the fade above it (ADR-152 a).
            'block_height' => 360,
            'scrim_fade' => 48,
        ],
    ],

    // M3.5 content and configuration (m3.5 contract §1).
    'content' => [
        // ADM-34: a signed draft preview token lives this long.
        'preview_minutes' => 15,
        // ADM-29: featured builds live at the same moment.
        'featured_live_max' => 8,
        'featured_max' => 24,
        'collections_max' => 24,
        'collection_vehicles_max' => 24,
        'announcements_max' => 10,
        // ADM-30 audience "new": registered within this many days (the app applies it).
        'announcement_new_days' => 14,
        // ADM-38: what speedclub:releases-sync reads: the repository's docs/RELEASES.md, else the copy the deploy package ships next to
        // artisan (scripts/dev/package-web.mjs writes it as RELEASES.md).
        'releases_path' => is_file(base_path('../docs/RELEASES.md')) ? base_path('../docs/RELEASES.md') : base_path('RELEASES.md'),
    ],

    // Public Blade pages (05_ARCHITECTURE §18). Off keeps search engines out: robots.txt forbids everything and every page says noindex.
    'public_pages' => [
        'allow_indexing' => (bool) env('ALLOW_INDEXING', env('APP_ENV', 'production') !== 'staging'),
        // What one sitemap file may hold per sitemaps.org. Newest first, so what falls off is what changed longest ago.
        'sitemap_max_urls' => 50000,
        'sitemap_path' => 'sitemap/sitemap.xml',
        'og_default' => '/brand/og-default.jpg',
        // SEC-414-05: link-preview cards of events, businesses and brands drawn per owner (organiser, business owner; a brand on its
        // own) and hour; beyond it the address answers the brand card until the hour is over. A changed subject draws one new pair.
        'og_partner_draws_per_hour' => 30,
        // M2.7 WEB-04 on staging: the tester APK and its SHA-256 (64 hex digits). Empty in production, where the stores take over.
        'tester_apk_url' => env('TESTER_APK_URL'),
        'tester_apk_sha256' => env('TESTER_APK_SHA256'),
        // Signed-in web members go from /v to /app/v (05_ARCHITECTURE §4, RedirectMembersToApp), now that VEH-01 exists in the
        // member web app (ADR-148 i). Off, they get the Blade page a guest gets. Not from env, since it follows the code.
        'redirect_members_to_app' => true,
        // Slug of the build on the landing page. Empty: the public vehicle with the most mods.
        'featured_slug' => env('FEATURED_VEHICLE_SLUG'),
    ],

    // M5.9b STREET DEX (10 §16.2, docs/reports/phase-5/m5.9b-contract.md, ADR-508).
    'dex' => [
        // The same car by the same member within this many hours answers with the existing card (200, meta.duplicate).
        'duplicate_hours' => 24,
        // Accounts younger than this may scan, but the spot is not counted (no Dex entry, no stats, no XP).
        'young_account_hours' => 24,
        // A spot in this window (Europe/Berlin, display_timezone) counts, but its city is never shown for a single car.
        'night' => ['from' => '22:00', 'to' => '06:00'],
        // The first unique spotters of a car keep the "First Spotter" foil for good.
        'first_spotters' => 3,
        // "Street Famous" tiers by unique spotters (the badges are M5.9d's).
        'street_famous_tiers' => [10, 50, 100, 500],
        // GET me/dex page size; DEX-06 lists this many recent spotters and this many days.
        'per_page' => 30,
        'recent_spotters' => 10,
        'stats_days' => 30,
        // Rarity thresholds (contract §6), shown in the app's "So funktioniert Seltenheit" (GET rarity-rules). Highest applicable wins:
        // ghost > legend > rare > tuned > street. The Build Score parts apply once M5.9c's build_scores exist.
        'rarity' => [
            'tuned' => ['min_build_score' => 500],
            'rare' => ['max_same_generation' => 5],
            'legend' => ['min_build_score' => 850, 'unique_generation' => true],
            'ghost' => ['opt_in' => true],
        ],
        // M5.9b part 2: the grouped owner alert (dex:spot-alerts, every 3 hours). A car whose owner was never told looks back this far.
        // window_hours: "nothing live" (CR-P5G-01): DEX-06/INS-01 name recent spotters and fill the day series only with spots older than
        // this (keep it equal to the dex:spot-alerts rhythm in routes/console.php).
        'alerts' => [
            'window_hours' => 3,
            'lookback_hours' => 24,
            'seconds' => 40,
            'chunk' => 100,
        ],
        // GET spot-map (public, Entdecken › Treffen layer "Spots"): counted spots at least min_age_hours old and at most `days` old,
        // only cities whose spots are of at least min_cars different cars (SEC-P5G-03: five spots of one car never put its town on the
        // map); ghost cars and cars hiding their cities never count. Cached `cache_seconds`.
        'map' => [
            'min_age_hours' => 24,
            'min_cars' => 5,
            'days' => 90,
            'cache_seconds' => 3600,
        ],
        // dex:nightly (02:00–05:50 Europe/Berlin, every 10 minutes until the day's tasks are done): Dex numbers, rarity, stats and set
        // progress repair, `chunk` rows per step, each run stops after `seconds` and the next one resumes at its cursor.
        'nightly' => [
            'seconds' => 40,
            'chunk' => 200,
        ],
        // The sets (DexSetSeeder writes them to dex_sets; brand sets are created per make on its first spot).
        'sets' => [
            // JDM Legends: catalogue make / model / generation slugs, one slot each.
            'jdm_legends' => [
                ['nissan', 'skyline-gt-r', 'r32'],
                ['nissan', 'skyline-gt-r', 'r33'],
                ['nissan', 'skyline-gt-r', 'r34'],
                ['nissan', 'silvia', 's15'],
                ['toyota', 'supra', 'a80'],
                ['toyota', 'corolla-levin-trueno', 'ae86'],
                ['mazda', 'rx-7', 'fd'],
                ['honda', 'civic-type-r', 'ek9'],
                ['honda', 'integra-type-r', 'dc2'],
                ['honda', 's2000', 'ap1'],
                ['honda', 'nsx', 'na1-na2'],
                ['mitsubishi', 'lancer-evolution', 'vii-ix'],
                ['subaru', 'impreza-wrx-sti', 'gc'],
            ],
            // Brand sets: spot this many different cars of one make; each tier completes in turn, the last completes the set.
            'brand_tiers' => [5, 10, 25],
            // City set: this many different cars in one city.
            'city_target' => 10,
            // Season sets: month-day window of the current year and the number of different cars.
            'seasons' => [
                'saisonstart' => ['starts_on' => '03-01', 'ends_on' => '04-30', 'target' => 10],
                'saison' => ['starts_on' => '05-01', 'ends_on' => '10-31', 'target' => 25],
            ],
        ],
    ],

    // M5.9c Build Score (10 §16.3, owner gift detail M5.9c, m5.9c contract §3). Shown in the app under "So entsteht dein Build Score"
    // (GET build-score/formula). Each item gives `points` per unit for at most `limit` units (null: once); its cap is points × limit.
    // Never points for power, speed, sound, price or money spent: a filled key spec counts, its value never does.
    'build_score' => [
        // Raise it with any change of the items below; stored with each score.
        'version' => '1',
        'max' => 1000,
        // The score at which each stage starts.
        'stages' => [1 => 0, 2 => 200, 3 => 400, 4 => 600, 5 => 800],
        'parts' => [
            'completeness' => [
                'photos' => ['points' => 20, 'limit' => 6],
                'key_specs' => ['points' => 10, 'limit' => 10],
                'description' => ['points' => 50, 'limit' => null, 'min_chars' => 200],
                'cover_focal' => ['points' => 30, 'limit' => null],
            ],
            'documentation' => [
                'documented_mods' => ['points' => 25, 'limit' => 10],
                'registered_mods' => ['points' => 5, 'limit' => 10],
            ],
            'community' => [
                'reactors' => ['points' => 2, 'limit' => 50],
                'spotters' => ['points' => 1, 'limit' => 100],
                'followers' => ['points' => 1, 'limit' => 50],
            ],
            'journey' => [
                'timeline' => ['points' => 10, 'limit' => 8],
                'before_after' => ['points' => 15, 'limit' => 3],
                'history_span' => ['points' => 1, 'limit' => 25],
            ],
        ],
        // The debounce of RecomputeBuildScore: edits within this window are computed together.
        'debounce_seconds' => 30,
        // build-score:nightly (00:30–01:55 Europe/Berlin, before dex:nightly reads the totals): every score again as a backstop
        // (moderation, deleted or blocked members), then the ranks; `chunk` rows per step, each run stops after `seconds`.
        'nightly' => [
            'seconds' => 40,
            'chunk' => 200,
        ],
        // A rank only for a group of at least this many public, non-ghost, non-sample cars.
        'ranks' => [
            'min_group' => 3,
        ],
        // A before/after update holds exactly one pair: two photos, before then after.
        'before_after_photos' => 2,
    ],

    // M5.9e Season Wrapped (10 §16.5, owner gift detail M5.9e, m5.9e contract). Seasons: `YYYY-saison` = 1 Mar–31 Oct and `YYYY-jahr`
    // = the calendar year, both Europe/Berlin. Releases: remote config `wrapped.releases` ({season_key: ISO 8601}) over `releases` here.
    // Flags `wrapped` (the feature) and `wrapped.countdown` (the Home banner `countdown_days` before a release).
    'wrapped' => [
        'timezone' => 'Europe/Berlin',
        'season_start' => '03-01',
        'season_end' => '10-31',
        // Defaults under the remote config; staff publish the real dates in ADM-37 (remote_config.wrapped.releases).
        'releases' => [],
        'countdown_days' => 7,
        // The nightly generation runs from this many days before a release until the release (schedule in routes/console.php).
        'generate_days_before' => 7,
        // GenerateWrapped: members per chunk, and each run stops after `seconds` (≤ 50 s per run on shared hosting).
        'chunk' => 100,
        'seconds' => 40,
        // Spots card: at most this many city names (day spots only).
        'max_cities' => 5,
        // Treffen card: at most this many public meet titles.
        'max_meets' => 3,
        // Percentile card: only with at least `min_members` members with a ranked car in the Bundesland, and only when the member is
        // within the top `max_top` per cent (a "Top 87 %" card would shame; it is left out instead).
        'percentile' => [
            'min_members' => 20,
            'max_top' => 50,
        ],
        // "Build Spirit" (contract §4): fixed rules over the member's documented, installed mods of the season (all of them when the
        // season has fewer than `min_season_mods`). The first rule in `order` that holds wins, so a tie always resolves the same way.
        'spirit' => [
            'order' => ['restomod_romantic', 'track_day_tactician', 'shakotan_artist', 'engine_purist', 'detail_perfectionist', 'daily_hero'],
            'min_season_mods' => 3,
            // Share of the counted mods (0–1) a category group needs to be "dominant", and the fewest mods a mix rule looks at.
            'dominant_share' => 0.5,
            'min_mods' => 3,
            'groups' => [
                'shakotan_artist' => ['wheels_tires', 'suspension'],
                'engine_purist' => ['engine_performance', 'exhaust', 'drivetrain'],
                'detail_perfectionist' => ['interior', 'electronics'],
            ],
            // Engine Purist: no mod of these categories at all ("no exterior").
            'exterior' => ['aero_body', 'wheels_tires'],
            // Restomod Romantic: a car of model year ≤ max_year with at least min_mods installed mods.
            'restomod' => ['max_year' => 1995, 'min_mods' => 2],
            // Daily Hero: at least min_logs maintenance logs, at most max_mods mods, active (logs or updates) in min_months months.
            'daily_hero' => ['min_logs' => 3, 'max_mods' => 2, 'min_months' => 3],
        ],
    ],

    // HOME-01 P1-lite (02_PRODUCT_SPEC §3.8, M1.8). The Phase 3 admin takes the editorial list over.
    // M2.3 DISC-01: at most this many Kollektionen are read per page view.
    'discover' => [
        'collections' => 12,
    ],

    // docs/DEPLOY.md §5: on a host that disables proc_open the cron runs `php artisan speedclub:schedule-inline`; this tells the
    // doctor so, and the app's own backups (which need proc_open for the dump) stay off there.
    'scheduler' => [
        'inline' => (bool) env('SCHEDULER_INLINE', false),
        // M5.11 (ADR-503): GET /internal/cron/{token} for hosts whose cronjobs call a URL (ALL-INKL). CRON_TOKEN is at least 32
        // random characters (php -r "echo bin2hex(random_bytes(32));"); shorter or empty means the endpoint does not exist (404).
        'cron_token' => (string) env('CRON_TOKEN', ''),
        'cron_min_token_length' => 32,
        // Requests per minute and IP, valid or not (a cronjob needs 1); the lock keeps two triggers from running the scheduler at once.
        'cron_max_per_minute' => 20,
        'cron_lock_seconds' => 120,
    ],

    // ADR-539: the web installer of a host without SSH and cron (ALL-INKL Private, DEPLOY_ALLINKL.md): /internal/setup/{token}
    // and /internal/maintenance/{token}/on|off. SETUP_TOKEN is at least 32 random characters (php -r "echo bin2hex(random_bytes(32));");
    // shorter or empty means both pages do not exist (404). The token is read from .env on every request (App\Services\Setup\SetupToken),
    // so a new one works although the config is cached; after a successful setup the token is spent until .env carries a new one.
    'setup' => [
        'token' => (string) env('SETUP_TOKEN', ''),
        'min_token_length' => 32,
        // Requests per minute and IP, valid or not: a setup needs a handful.
        'max_per_minute' => 20,
        // Seconds the setup may run; asked of set_time_limit(), which a host may refuse.
        'time_limit_seconds' => 300,
    ],

    'home' => [
        // Slugs (or public ids) of the featured builds, in order, comma separated. Hidden ones are skipped; empty slots are
        // filled with the most complete public builds.
        'featured_slugs' => array_values(array_filter(array_map(trim(...), explode(',', (string) env('HOME_FEATURED_SLUGS', ''))))),
        'featured_limit' => 3,
        // The fallback picks among this many most recently changed public builds, one per owner.
        'featured_candidates' => 60,
        'new_builds_page_size' => 20,
        'new_builds_max_page_size' => 50,
        // M2.2 "Für dich · Folge ich" (GET feed): items per page, vehicles and update rows together.
        'feed_page_size' => 20,
        'feed_max_page_size' => 30,
        // FS-2 modules of GET home/modules.
        'build_update_rows' => 3,
        'active_members' => 12,
        'active_members_days' => 14,
        // DQ-293 car_short ("Skyline R34", "M4 G82"): catalogue models ({make}--{model}) whose name carries a badge the short form leaves
        // out. Every other model keeps its name; generations lose a bracket ("VII (5G)" → "VII").
        'car_short_models' => [
            'nissan--skyline-gt-r' => 'Skyline',
            'subaru--impreza-wrx-sti' => 'Impreza',
            'toyota--corolla-levin-trueno' => 'Corolla',
        ],
        'popular_mods' => 12,
        // A brand or part qualifies when installed on at least this many builds of different owners in the window; with fewer than
        // popular_mods_minimum labels in popular_mods_days, the fallback window applies.
        'popular_mods_min_builds' => 2,
        'popular_mods_days' => 7,
        'popular_mods_fallback_days' => 30,
        'popular_mods_minimum' => 3,
        // Empty "Folge ich": members to follow.
        'suggestions' => 6,
        // Für dich ranking (02_PRODUCT_SPEC §3.8, proposed ADR in the M2.2 handover). php artisan home:rank writes rank_score hourly.
        'ranking' => [
            'half_life_hours' => 72,
            // Cover photo, long edge in pixels => factor; below the last one quality_floor.
            'quality_steps' => [1600 => 1.0, 1080 => 0.85],
            'quality_floor' => 0.7,
            'engagement_days' => 7,
            // engagement = min(cap, saves_weight × ln(1 + saves) + followers_weight × ln(1 + new followers of the owner))
            'saves_weight' => 0.1,
            'followers_weight' => 0.05,
            'engagement_cap' => 0.3,
            // Added for a build of featured_slugs.
            'admin_boost' => 0.5,
            // At most this many items of one owner in a row.
            'max_run' => 2,
            // One update row after this many vehicle cards.
            'update_every' => 3,
            // Builds held back for the diversity rule; with more, the rule gives way for that stretch.
            'max_deferred' => 10,
            'chunk' => 200,
            // home:rank gives up after this long without switching epochs (the scheduler's run must end within the minute).
            'max_seconds' => 45,
        ],
        // The reference time of Home's windows and decay (App\Support\HomeClock). Empty: the real now. Locally the demo's NOW, so the
        // demo looks alive and the visual matrix stays deterministic (ADR-166). Production and staging leave HOME_CLOCK empty.
        'clock' => env('HOME_CLOCK', env('APP_ENV') === 'local' ? DemoSeeder::NOW : null),
    ],

    // M2.2 notifications (02_PRODUCT_SPEC §7, 05_ARCHITECTURE §6). Texts in lang/{de,en}/notifications.php.
    'notifications' => [
        'page_size' => 30,
        'max_page_size' => 50,
        // Actors shown on a grouped row ("lukas.sc und 3 weitere").
        'actors_shown' => 3,
        // Days and groups count in this zone; so do quiet hours.
        'timezone' => 'Europe/Berlin',
        // A grouped row pushes again at most this often, however many members join it.
        'group_push_cooldown_minutes' => 15,
        // Followers notified per queued job of a publication; the job queues the next slice itself.
        'fanout_chunk' => 200,
        // Builds per queued slice of the weekly saved-builds digest.
        'digest_slice' => 200,
        // notifications:prune (daily) deletes rows whose last event is older than this.
        'retention_days' => 180,
        // M5.9b (10 §16, owner gift detail): the gift social types (App\Services\Notifications\SocialPushLimiter::TYPES) push at most
        // once per member and Europe/Berlin day across all of them; the rest stay in the in-app list. They never push inside this
        // window, whatever the member's own quiet hours say (theirs apply on top).
        'social_quiet_hours' => ['from' => '22:00', 'to' => '08:00'],
        // M5.7 (10 §6, m5.7-contract §8.3): the system's own prompts and summaries (EngagementPushLimiter::TYPES) push at most this often per
        // member and ISO week (Europe/Berlin), never more than 3; further rows stay in the in-app list.
        'engagement_weekly_max' => 3,
    ],

    // M5.7 Engagement (10 §6, m5.7-contract §1, §2, §12). Views: one per viewer, subject and Europe/Berlin day, the viewer only as a hash
    // keyed with the day's salt (deleted when the day ends); raw events kept raw_retention_days, then pruned (views:prune, batches of
    // prune_batch, stops after `seconds`); the daily totals stay. INS-01: the last week_days days against the week_days before, a series
    // of `days` days; no percentage while the previous week had fewer than delta_min_base views (no "+300 %" from 1 to 4).
    // M5.7 build prompts (10 §6.2, m5.7-contract §4.2): plans:due-prompts every ten minutes 10:00–11:55 Europe/Berlin, at most one prompt per
    // owner in `every_days`, stops after `seconds`. Weekly recap (10 §6.3, §6): recap:weekly Sundays 18:00–21:55 Europe/Berlin, `chunk`
    // members per query, stops after `seconds`; due maintenance within `maintenance_days`, Treffen nearby within `events_days`.
    'build_prompts' => [
        'every_days' => 7,
        'seconds' => 40,
    ],
    'weekly_recap' => [
        'chunk' => 200,
        'seconds' => 40,
        'maintenance_days' => 14,
        'events_days' => 7,
    ],
    'insights' => [
        'timezone' => 'Europe/Berlin',
        'raw_retention_days' => 90,
        'days' => 30,
        'week_days' => 7,
        'delta_min_base' => 5,
        'prune_batch' => 5000,
        'seconds' => 40,
    ],

    // M5.9d supporting system (10 §16.4, owner gift detail M5.9d, m5.9d contract §1–§5). Fixed rules only, never random; nothing for likes,
    // reactions, posting volume or signing in; no money; samples never earn anything.
    // XP: points per real action (GET me/level `rules`), a cap per member and Europe/Berlin day across all types (a capped event keeps its
    // row with the points that were left, possibly 0, and `capped`), per-type day maxima (`daily_max`, XP). build_update has one: one update
    // a day earns XP, so posting volume never does (10 §16 hard rule). Levels: the XP at which each level starts (titles in lang/*/levels.php).
    'xp' => [
        'daily_cap' => 200,
        'types' => [
            'first_vehicle' => ['points' => 50, 'daily_max' => null],
            'documented_mod' => ['points' => 20, 'daily_max' => null],
            'build_update' => ['points' => 15, 'daily_max' => 15],
            'new_spot' => ['points' => 10, 'daily_max' => null],
            'set_completed' => ['points' => 100, 'daily_max' => null],
            'event_checkin' => ['points' => 40, 'daily_max' => null],
            'forum_solution' => ['points' => 30, 'daily_max' => null],
            'helpful_received' => ['points' => 2, 'daily_max' => 20],
        ],
        'levels' => [1 => 0, 2 => 100, 3 => 250, 4 => 500, 5 => 900, 6 => 1500, 7 => 2400, 8 => 3600, 9 => 5200, 10 => 7500],
    ],

    // Badges: the nightly retroactive run (badges:nightly, every 10 min 03:05–05:55 Europe/Berlin until done) and the admin's "Jetzt
    // anwenden" walk members in chunks; each run stops after `seconds`.
    'badges' => [
        'chunk' => 200,
        'seconds' => 40,
    ],

    // Car of the Day: picked at 17:55, published at 18:00 Europe/Berlin (car-of-the-day:run every five minutes 17:55–23:55 catches up a
    // late cron). A candidate needs a Build Score of at least min_build_score, at least min_photos usable photos and no feature in the
    // last gap_days; the Bundesland rotates (round-robin by last use, any Bundesland when none has a candidate). Never a sample in
    // production; elsewhere only when no real candidate exists (badged "Beispiel"). The opt-in push goes to `fanout_chunk` members per
    // step of a run.
    'car_of_the_day' => [
        'timezone' => 'Europe/Berlin',
        'pick_at' => '17:55',
        'publish_at' => '18:00',
        'min_build_score' => 400,
        'min_photos' => 4,
        'gap_days' => 180,
        'story_max' => 140,
        'fanout_chunk' => 200,
        'seconds' => 40,
        // R4-2.1 (contract-cotd-voting), flag cotd_voting: a round for day D opens at publish_at on D−1 and closes at closes_at on D;
        // candidates are the Picker's top `candidates` real builds (at least min_candidates, else no round); accounts vote from
        // min_account_days after sign-up.
        'voting' => [
            'closes_at' => '17:00',
            'candidates' => 3,
            'min_candidates' => 2,
            'min_account_days' => 3,
            // ADR-535: outside production only, the sample builds that fill up a short round need this many usable photos (the seed
            // photos give a showcase build 1–3); real candidates and production keep min_photos.
            'sample_min_photos' => 1,
        ],
    ],

    // Founding Member #0001–#1000: assigned once at activation (verified address + current terms), only where APP_ENV is in
    // `environments`, never for sample or editorial accounts or the addresses of these domains (demo and test accounts), never re-used.
    'founding' => [
        'environments' => ['production'],
        'max' => 1000,
        'excluded_email_domains' => ['speedclub.test', 'example.com', 'example.org', 'example.net', 'example.test', 'beispiel.test'],
    ],

    // Invite codes: `per_member` codes of `length` Crockford characters, created on the first GET me/invites.
    'invites' => [
        'per_member' => 5,
        'length' => 8,
    ],

    // M2.4 messaging (02_PRODUCT_SPEC §3.6, m2.4-contract). Bodies never leave messages.body (ADR-125).
    'messaging' => [
        'body_max_length' => 2000,
        'inbox_page_size' => 30,
        'inbox_max_page_size' => 50,
        // GET conversations/{id}/messages: `before` pages and the newest page; `after` (polling) returns up to after_limit at once.
        'thread_page_size' => 30,
        'thread_max_page_size' => 50,
        'after_limit' => 100,
        'query_max_length' => 64,
        // Not in the spec: pins per member, so "pinned first" stays a short list.
        'max_pinned' => 5,
        // [SIG sig.msg_typing] How long one typing signal holds (cache typing_until).
        'typing_seconds' => 5,
        // Not in the spec: at most one push per conversation and recipient this often; a burst of messages buzzes once.
        'push_cooldown_seconds' => 30,
        // Push previews (opt-in, ADR-035) are cut to this many characters.
        'push_preview_length' => 120,
        // The daily e-mail digest (opt-in): chat messages unread for longer than this.
        'digest_after_hours' => 12,
        'digest_chunk' => 200,
        // An uploaded photo no message used is removed after this long (media:prune).
        'unused_photo_hours' => 24,
        // Chat photos (lead ruling, M2.4 review #5): variants and original on the private disk, served only through signed URLs bound to
        // the photo, the width and the viewer, re-checked on every fetch. A URL holds for media_url_minutes, rounded to that step so a
        // poll gets the same URL (and its 304) within the step: between 10 and 20 minutes.
        'media_disk' => env('MEDIA_PRIVATE_DISK', 'local'),
        'media_url_minutes' => 10,
    ],

    // Expo Push API (05_ARCHITECTURE §11). Off by default: then nothing is sent and in-app rows and e-mails work as before. Needs the
    // Expo project and FCM credentials uploaded to Expo (owner action).
    'push' => [
        'enabled' => (bool) env('PUSH_ENABLED', false),
        'send_url' => 'https://exp.host/--/api/v2/push/send',
        'receipts_url' => 'https://exp.host/--/api/v2/push/getReceipts',
        'batch_size' => 100,
        'receipts_batch_size' => 1000,
        // Expo keeps receipts about a day; tickets older than this are dropped unchecked.
        'ticket_max_age_hours' => 24,
        'timeout_seconds' => 10,
    ],

    // Web Push of the member web (M4.15, ADR-452, ADR-456): VAPID keys only from env (php artisan speedclub:web-push-keys prints a pair,
    // owner action OA-32). Without all three nothing is sent and app-config's web_push.vapid_public_key is null, so the member web
    // hides the browser option; the flag web_push switches delivery on and off on top. The endpoints a browser may register are those of
    // the browser vendors' push services (exact host or a subdomain of it), so the server never posts to an address a member chose.
    'web_push' => [
        'public_key' => env('WEB_PUSH_VAPID_PUBLIC_KEY'),
        'private_key' => env('WEB_PUSH_VAPID_PRIVATE_KEY'),
        // mailto: or https: the push services' contact for this sender.
        'subject' => env('WEB_PUSH_VAPID_SUBJECT'),
        'hosts' => ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'],
        // How long a push service keeps a notification for a browser that is offline.
        'ttl_seconds' => 43200,
        // Per push service request; a member has at most max_per_member browsers, sent to one after the other inside the push job.
        'timeout_seconds' => 5,
        'connect_timeout_seconds' => 3,
        'max_per_member' => 5,
        // Failed sends in a row (other than 404/410, which remove the subscription at once) after which a subscription is dropped.
        'max_failures' => 5,
        // SEC-414-02: a subscription the browser has not renewed (a sign-in re-registers it) for this many days goes in the hourly prune,
        // whatever the session driver; one of an ended browser session goes at once (database sessions).
        'orphan_days' => 30,
        // The longest stored endpoint; browsers send a few hundred characters.
        'endpoint_max_length' => 2048,
    ],

    // DISC-01 and DISC-02 P1-lite (02_PRODUCT_SPEC §3.7, 05_ARCHITECTURE §10). Filters, facets and sorts are Phase 2.
    'search' => [
        'query_max_length' => 100,
        'page_size' => 20,
        'max_page_size' => 50,
        // GET search: the first rows of each kind, with the counts for the tabs "Fahrzeuge (124) · Mitglieder (8)".
        'overview_vehicles' => 10,
        'overview_members' => 5,
        // Makes named on a member row: "3 Fahrzeuge · BMW, Nissan".
        'member_makes' => 3,
        // The tab counts stop here and say so ("1000+"): counting further only means reading more rows (SEC-M18-01).
        'count_cap' => 1000,
        // vehicle_search.search_keys of one build. Every search reads the keys of every public build, so this bounds a search
        // (SEC-M18-01); a typical build needs well under 3 KB, 150 mods with distinct words about 6 KB.
        'keys_max_bytes' => 8000,
        // M2.3 facets: brand groups list the brands with the most builds, plus any active brand.
        'facet_brands' => 20,
        // DISC-01 [SIG sig.similar_builds] "Mitglieder mit ähnlichen Autos" and VEH-01 "Ähnliche Builds".
        'similar_members' => 8,
        'similar_builds' => 8,
        'similar_builds_per_owner' => 2,
        // Same make counts as similar when the power differs by at most this share (m2.3 contract §7).
        'similar_power_share' => 0.2,
        // Typed words that stand for a make although the catalogue names it otherwise (search/interpret). Only targets that exist count.
        'make_aliases' => ['vw' => 'volkswagen', 'mercedes' => 'mercedes-benz', 'benz' => 'mercedes-benz', 'merc' => 'mercedes-benz', 'alfa' => 'alfa-romeo', 'chevy' => 'chevrolet', 'aston' => 'aston-martin'],
    ],

    // Optional services: missing keys disable the feature gracefully.
    'services' => [
        'expo_access_token' => env('EXPO_ACCESS_TOKEN'),
        'ai_provider' => env('AI_PROVIDER'),
        'turnstile_site_key' => env('TURNSTILE_SITE_KEY'),
        'turnstile_secret' => env('TURNSTILE_SECRET'),
        'sentry_dsn' => env('SENTRY_LARAVEL_DSN'),
    ],

    // M3.7 [AI] features (02_PRODUCT_SPEC §6, ADR-030, m3.7 contract §1). The provider is speedclub.services.ai_provider (AI_PROVIDER) and
    // its key config/ai.php; without both AiGateway::available() is false, no ai.* flag can be switched on and every endpoint answers
    // 404 feature_disabled (OA-18).
    'ai' => [
        'model' => env('AI_MODEL', 'claude-haiku-5-5'),
        // Seconds per provider request; one retry on a connection error, an overload or a rate limit (16 s at most per call).
        'timeout' => (int) env('AI_TIMEOUT', 8),
        'retries' => 1,
        // Provider calls per feature and day (Europe/Berlin), across all members; above it the feature answers 503 ai_budget_exhausted.
        'daily_calls' => [
            'nl_search' => (int) env('AI_DAILY_NL_SEARCH', 2000),
            'mod_assist' => (int) env('AI_DAILY_MOD_ASSIST', 1000),
            'photo_tagging' => (int) env('AI_DAILY_PHOTO_TAGGING', 2000),
            'translate' => (int) env('AI_DAILY_TRANSLATE', 3000),
            'description_assist' => (int) env('AI_DAILY_DESCRIPTION_ASSIST', 500),
            'moderation_triage' => (int) env('AI_DAILY_MODERATION_TRIAGE', 2000),
            // M5.9: a miss of the shared spec cache, a part the catalogue did not find, the background forum summaries.
            'vehicle_specs' => (int) env('AI_DAILY_VEHICLE_SPECS', 300),
            'product_match' => (int) env('AI_DAILY_PRODUCT_MATCH', 1000),
            'forum_summary' => (int) env('AI_DAILY_FORUM_SUMMARY', 300),
        ],
        // SEC-P3-19: one member's daily share of each feature's budget (2 %, at least 20 calls); above it 429 ai_daily_limit. AI features
        // also need a verified e-mail address.
        'member_daily_share' => (float) env('AI_MEMBER_DAILY_SHARE', 0.02),
        'member_daily_min' => (int) env('AI_MEMBER_DAILY_MIN', 20),
        // ai_calls rows (no content) and the translation cache.
        'calls_retention_days' => 90,
        'translation_cache_days' => 30,
        // M5.9 (m5.9-contract §2): shared caches without member data — spec suggestions per generation, normalised part texts.
        'spec_cache_days' => 180,
        'normalisation_cache_days' => 30,
        // M5.9 forum summary: threads with at least min_replies visible replies; rebuilt after refresh_after_replies new replies or after
        // refresh_days with new replies; at most max_posts posts of at most post_chars characters go in; forum:summaries takes chunk
        // threads per query and stops after `seconds`.
        'forum_summary' => [
            'min_replies' => 21,
            'refresh_after_replies' => 10,
            'refresh_days' => 7,
            'max_posts' => 60,
            'post_chars' => 600,
            'chunk' => 20,
            'seconds' => 40,
        ],
        // A staff case opened on a photo the triage scored at least this high counts as detected by automated means (ai_detected).
        'detection_score' => 70,
        // What a prompt may carry at most (characters): report details per report, and a target's public text.
        'triage_text_chars' => 500,
    ],

    'mobile' => [
        'android_package' => env('ANDROID_PACKAGE', 'de.speedclub.app'),
        'android_cert_sha256' => env('ANDROID_CERT_SHA256'),
        'ios_team_id' => env('IOS_TEAM_ID'),
        'ios_bundle_id' => env('IOS_BUNDLE_ID', 'de.speedclub.app'),
        'store_url_ios' => env('STORE_URL_IOS'),
        'store_url_android' => env('STORE_URL_ANDROID'),
    ],

    // Hosts besides the one in APP_URL that may reach the app, comma separated (for example www.example.de).
    // TrustHosts rejects every other Host header outside local and tests.
    'trusted_hosts' => array_values(array_filter(array_map(trim(...), explode(',', (string) env('TRUSTED_HOSTS', ''))))),

    // Proxies whose X-Forwarded-* headers count, comma separated IPs or CIDR ranges, or * for whichever proxy calls PHP.
    // Without this a TLS-terminating proxy looks like plain HTTP: no HSTS, and every member shares the proxy's rate limit.
    'trusted_proxies' => array_values(array_filter(array_map(trim(...), explode(',', (string) env('TRUSTED_PROXIES', ''))))),

    // Redirect plain HTTP to APP_URL in production. Off by default, see App\Http\Middleware\ForceHttps.
    'force_https' => (bool) env('FORCE_HTTPS', false),

    // ADR-113; 06_ADMIN_SPEC §4. php artisan audit:retention applies these daily.
    'audit' => [
        'access_data_months' => 12,
        'event_months' => 24,
        'archive_months' => 36,
        'archive_batch' => 1000,
        'archive_max_seconds' => 40,
    ],

    // M3.6 Team & roles (06_ADMIN_SPEC §2/§3, m3.6 contract §1).
    'team' => [
        // An invite link is valid this long and only once; a resend replaces it.
        'invite_hours' => 72,
        // At least one active Owner, at most this many who are not deactivated.
        'max_owners' => 3,
        // Wrong current codes at the ADM-51 TOTP steps (rotation, recovery codes) per account and minute.
        'code_attempts_per_minute' => 5,
        // A TOTP rotation not confirmed within this time is dropped; the old key works throughout.
        'rotation_minutes' => 15,
    ],

    // M3.6 GDPR requests (08_LEGAL_COMPLIANCE, Art. 12(3) GDPR: one month, extendable once by two more with a reason).
    'privacy' => [
        'due_months' => 1,
        'extension_months' => 2,
        // The dashboard queue "DSGVO-Fristen ≤ 7 Tage".
        'due_soon_days' => 7,
        'evidence_max_kb' => 10240,
        'evidence_directory' => 'privacy-evidence',
        // Closed requests and their evidence go after this long (privacy:prune, daily; ADM-47 bounds 36–60): the accountability of
        // Art. 5(2) GDPR for the 3-year limitation period of § 195 BGB. The privacy policy still holds a placeholder (OA-10).
        'retention_months' => 36,
    ],

    // Local and staging seeders only, never production.
    // The user agent of the E2E harness's API sign-ins (web/tests/e2e/support/auth.mjs). DemoSeeder stores it as a known device of
    // every demo member, so harness sign-ins from Chromium and WebKit write no new-device notice into HOME-02 (M2.2 test round D2).
    // Never set in production, where no demo member exists.
    'qa' => [
        'user_agent' => env('APP_ENV', 'production') === 'production' ? null : env('QA_USER_AGENT', 'SpeedClubQA/1.0 (Playwright)'),
    ],

    'demo' => [
        'member_password' => env('DEMO_MEMBER_PASSWORD'),
        'staff_password' => env('DEMO_STAFF_PASSWORD'),
        // The TOTP key (base32) of the showcase staff account admin.demo@speedclub.test (DemoShowcaseSeeder), so a crawler can pass the
        // second factor. Empty: the account is created without TOTP and enrols at its first sign-in like every staff account.
        'staff_totp_secret' => env('DEMO_STAFF_TOTP_SECRET'),
        // DemoSeeder runs by itself in local; staging only with this on; never in production.
        'seed_on_staging' => (bool) env('DEMO_SEED_ON_STAGING', false),
        // Upper limit of photos DemoSeeder sends through the media pipeline. 0 seeds no photos.
        // The only database whose demo seed may clear the shared media folder of orphaned files (DemoSeeder; ADR-253).
        'clear_media_database' => env('DEMO_CLEAR_MEDIA_DATABASE', 'speedclub'),
        'photo_limit' => (int) env('DEMO_PHOTO_LIMIT', 60),
    ],

    // php artisan speedclub:doctor, 05_ARCHITECTURE §19
    'doctor' => [
        'response_flush_functions' => ['fastcgi_finish_request', 'litespeed_finish_request'],
        'php_minimum' => '8.3.0',
        'mysql_minimum' => '8.0.0',
        'mariadb_minimum' => '10.6.0',
        'php_extensions' => [
            'ctype', 'curl', 'dom', 'exif', 'fileinfo', 'filter', 'gd', 'intl', 'mbstring', 'openssl',
            'pdo_mysql', 'session', 'sodium', 'tokenizer', 'xml', 'zip',
        ],
        'php_limits' => [
            'memory_limit' => '256M',
            'upload_max_filesize' => '20M',
            'post_max_size' => '25M',
        ],
        'max_execution_time' => 60,
        'cron_max_age_minutes' => 3,
        'queue_max_backlog_minutes' => 5,
        // Folders of the public disk that must never answer a listing (EnvironmentDoctor::directoryListing).
        'listing_paths' => ['/storage/media/', '/storage/og/v/', '/storage/og/u/'],
    ],

];
