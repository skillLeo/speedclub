# 10 — PHASE 5 · Client feedback round 1 → SPEED CLUB 2.1 + go-live on joinspeedclub.com

> **What this is:** the complete directive for Phase 5. It turns the client's first review of 2.0 into a finished, launch-ready product: engagement features, the **Sticker** (renamed from "QR-Code") with a sticker designer, a **Shop** tab, a first-class **Treffen** (events) page, a **one-scroll vehicle profile**, a **Forum**, natural AI helpers, the admin publish bug, and the move to the client's own hosting and domain.
> **Precedence:** this file overrides `docs/09_PREMIUM_2_0.md` and all older docs where they conflict (navigation, vehicle profile layout, naming, sample content policy for the client demo). Everything else in 09 still applies: design system 2.0, the speedclub-design skill, design-lint, the module loop (09 §0.2), token discipline (09 §0.3), owner-blocked policy (09 §0.4), honesty (09 §0.5).
> **Version:** 2.1.0 · tags `phase-5` + `v2.1.0-rc.1`.
> **Status:** owner-approved 2026-11-14 (closes P5-SPEC). Phase 4 is complete (2.0.0 on staging). This file replaces any draft `docs/10_CLIENT_ROUND_1.md`; keep from the draft only what does not conflict and list the differences in HANDOFF. If ADR or flow numbers used here are already taken, take the next free ones and note the mapping.

---

## 0. The client's words (source of truth for this phase)
> "Overall, I really like it. The design looks great, very modern and clean!"
1. **More reasons to come back** — profile views, vehicle views, tracking upcoming modifications and build progress, and the **forum** we discussed.
2. **Car Sticker** — call it "Car Sticker"/"Sticker", not "QR Code". One of the most important parts of the platform. Users customise their stickers with different designs, with or without username, QR code, etc. The focus is the sticker itself.
3. **Shop** — move Messages to the top header, put Shop in the bottom navigation. Clothing and other products later; for now show products and redirect to **Shopify** for checkout.
4. **Events** — an Events page where users find car meets and other events.
5. **Vehicle profiles** — everything visible in **one scrollable overview** (specs, modifications, future plans …), no switching between categories.
6. **Community & AI** — a real community for people who love, maintain and modify their cars; include the AI features naturally and simply; the platform must not feel overloaded.
7. **Bug** — in the admin panel he cannot publish features.

Product rule for everything below: **every addition must make the app simpler to understand, not busier.** One new idea per screen, progressive disclosure, no new settings unless needed.

---

## 1. Navigation 3.0 (overrides 09 §6.1)
**Bottom tabs (5):** **Start · Entdecken · Garage · Shop · Profil** (EN: Home · Discover · Garage · Shop · Profile).
- **Nachrichten moves to the header** of Start (and Entdecken): paper-plane/chat icon with unread badge (tnum, "9+") next to the notifications bell — Instagram pattern. Push notifications and deep links open conversations directly. Web desktop sidebar keeps Nachrichten as its own item.
- **Entdecken** gets a top SegmentedControl **Builds · Treffen · Forum** (swipeable pages). Each page has its own search and deep link: `/discover`, `/events`, `/forum`. Treffen and Forum are therefore real pages, reachable in one tap from the Discover tab, from Home modules and from push.
- **Web:** sidebar ≥ 1280 = Start · Entdecken · Treffen · Forum · Garage · Shop · Nachrichten · Profil; rail 768–1279 = the 5 tabs + Nachrichten; floating tab bar < 768 = the 5 tabs.
- Tab icons: Shop = SF `bag` / Material `shopping_bag` / Phosphor `Bag`; Garage keeps the custom glyph. Update `mobile/src/navigation/tabs.ts`, all three implementations, E2E navigation tests, screenshots.
- ADR-501 records the change (client decision overrides brief §8).

---

## 2. Car Sticker (renames and extends QR — the platform's signature)
**2.1 Naming everywhere.** UI, push, e-mail, admin, Blade, store texts, docs: **"Sticker"** (DE+EN; "Car-Sticker" in marketing copy). "QR-Code" survives only as a technical part *of* a sticker ("Sticker mit QR-Code"). Routes: `/stickers` (was `/profile/qr`), `/stickers/[vehicleId]` (was `/qr/[vehicleId]`), old routes 301/redirect. Public scan URL `/c/{code}` stays unchanged (printed stickers must keep working). Admin "QR-Register" → "Sticker-Register". Screen IDs QR-01…04 become STK-01…04; new STK-05…07.

**2.2 Sticker hub (STK-01 "Meine Sticker")** — one card per vehicle: live sticker render on a dark vinyl mock-up, status (aktiv/gesperrt), scans this week (tnum), actions "Gestalten" · "Bestellen" · "Herunterladen".

**2.3 Sticker designer (STK-05 — the flagship of this phase ★)**
- Full-screen editor: large live preview at top, controls in a bottom sheet with detents (native feel), undo/redo, autosave per vehicle.
- **Templates (6, all using the unchanged logo):** 1 *Classic* (brush logo + katakana + QR + username) · 2 *Minimal* (QR + small wordmark) · 3 *Banner* (windscreen strip, wordmark + username, optional QR at the end) · 4 *Plate* (licence-plate proportions, username in Archivo SemiExpanded — never imitates a real number plate layout) · 5 *Vertical JDM* (katakana column + QR) · 6 *Round* (circular badge, QR centre).
- **Options:** QR an/aus (off → warning "Ohne QR-Code kann niemand deinen Build scannen."), username an/aus, car name an/aus, custom line (≤ 24 chars, moderated by keyword rules), colourway (white print for dark glass · black print for light paint · white + Signal-Red accent), material note (transparent vinyl / white vinyl), size S/M/L in mm per template, mirrored print for inside-window placement.
- **Preview modes:** flat · "am Auto" (mock-up on 3 real licensed car-window photos, day/night) · actual size ruler.
- **QR safety:** error correction H, quiet zone ≥ 4 modules, minimum printed QR size 25 mm, contrast check; every design is decoded in-app (zxing/jsQR on a rendered bitmap) before it can be saved or ordered — "Scan-Test bestanden" badge.
- **Export:** vector SVG + print-ready PDF (exact size, 3 mm bleed, crop marks, CMYK-safe colours noted, design id printed in the slug area) + PNG for sharing. Generated server-side so the print file is identical everywhere (reuse the existing chillerlan + dompdf/SVG pipeline; fonts embedded).
- **Order (STK-06):** "Sticker bestellen" opens the Shop product "Car-Sticker" on Shopify with the design attached: use a Shopify cart permalink with cart attributes (`attributes[sticker_design]={designId}`, `attributes[vehicle]={slug}`) — verify the current Shopify cart-permalink syntax; the print partner downloads the PDF from an admin link by design id. Without a configured Shopify product the button shows "Bestellung bald verfügbar" (never broken).
- **Scan stats (STK-04):** scans per day (30-day sparkline), by source (Sticker-Scan vs. Link), first scan, total; private to the owner.
- Data: `sticker_designs` (vehicle_id, template, options json, version, qr_code_id, validated_at), history of versions; admin view of designs (ADM "Sticker-Designs") with download.
- Motion: template switch crossfade (effect.default), option toggles spring.fast, "am Auto" mock-up with subtle parallax on device tilt (expo-sensors, off with reduced motion), save = success haptic.

---

## 3. Shop (new tab)
- **SHOP-01 Shop** — header "Shop" + cart-less (checkout happens on Shopify). Order: hero banner (full-bleed product/lifestyle photo, editorial, admin-curated) · category chips Alle · Sticker · Bekleidung · Accessoires · product grid (2 columns, 4:5 photos, 0 gap radius rules from 09 §5 "wall" or 2 px gaps; name headline, price with "inkl. MwSt." caption) · "Dein Sticker" promo card linking to STK-05.
- **SHOP-02 Produkt** — gallery (swipe, zoom), name, price incl. VAT (PAngV), variant info (sizes/colours as chips, informational), description, shipping/returns link, primary **"Im Shop kaufen"** → opens the Shopify product URL (or cart permalink with the chosen variant) in the in-app browser (`expo-web-browser`), web: new tab. App Store/Play allow external checkout for physical goods — record in ADR-502.
- **Data source:** start with an **admin-managed catalogue** (ADM "Shop-Produkte": title, images, price, currency, variants text, category, Shopify URL/variant id, order, visible). Optional later: Shopify Storefront API sync when the client provides a Storefront token (owner action) — design the service interface now (`ShopCatalogue` with `local` and `shopify` drivers), implement `local` fully.
- Empty/loading/error states per 09; samples on staging badged "Beispiel".
- Flag `shop` (on staging, off production until the client's Shopify store and products exist).

---

## 4. Events page (Treffen) — first class
Everything in 09 §8.7 and §7.10 stays; additionally:
- `/events` is the Treffen page under Entdecken › Treffen and in the web sidebar. Default view: **"Diese Woche"** list grouped by day + map toggle; filters Heute · Wochenende · Monat · Entfernung · Art.
- Home module "Nächste Treffen" (2 cards) links here; event reminders and "Neues Treffen in deiner Nähe" (opt-in weekly) bring users back.
- Organisers can add a **gallery after the event** (photos from attendees, moderated) — a reason to return after the meet.
- Check-in at the event (optional QR on the organiser's phone → attendee gets "War dabei" on their profile) — flag `events.checkin`, off by default.

---

## 5. Vehicle profile — one scroll (overrides 09 §7.6 VEH-01 tabs)
Remove the Übersicht/Daten/Mods/Verlauf segmented tabs. One continuous, beautifully paced scroll:
1. Hero gallery (SM5) · 2 identity (name, model line, owner chip, badges) · 3 SpecStrip (SM6) · 4 actions (Folgen, Speichern, Teilen, Nachricht; owner: OwnerCapsule) · 5 **section index**: sticky chip row *Überblick · Daten · Mods · Pläne · Verlauf · Galerie* that **scrolls to the section** (spring.calm) and highlights the section in view (scroll-spy) — navigation aid, not tabs.
6. **Überblick** — description, Highlights rail, **Build-Fortschritt** card (see §6.2).
7. **Daten** — the 6 most important specs in a grid; "Alle Daten anzeigen" expands inline (spring.default), no page switch.
8. **Mods** — BuildSheet grouped by system; each group shows its top 3 with "+ 5 weitere" inline expand; counts tnum.
9. **Pläne** — upcoming modifications (status "Geplant"), each with target date (Monat Jahr), optional priority, optional private budget; owner can reorder and mark as "Verbaut" (moves to Mods with date + success haptic).
10. **Verlauf** — latest 3 timeline entries + "Ganzen Verlauf anzeigen" (inline expand or VEH-08 full page).
11. **Galerie** — 3-column wall preview + "Alle Fotos".
12. Forum threads about this car ("Diskussionen zu diesem Build"), Ähnliche Builds, footer.
Web desktop: same order; right sticky card (owner, spec summary, actions, sticker preview) and the section index as a vertical list on the left at ≥ 1440.
Performance: one FlashList/SectionList-based virtualised scroll (not nested ScrollViews), images lazy, odometer once.

---

## 6. More reasons to come back (engagement — useful, never spammy)
**6.1 Views and insights (owner-only)**
- Count **profile views** and **vehicle views** (deduplicated per viewer per 24 h; owner's own views excluded; bots excluded; sources: App, Web, Sticker-Scan, geteilter Link).
- **INS-01 "Statistiken"** (from Profil and from the owner's vehicle): views this week vs. last week (delta), 30-day chart (one accent + neutrals, tnum), top sources, sticker scans, new followers, saves, reactions summary. Plain language: "Dein E46 wurde diese Woche 128-mal angesehen – 31 % mehr als letzte Woche."
- **Privacy:** only aggregated counts; no list of who viewed (GDPR + avoids creepiness). Raw view events kept 90 days, then aggregated daily. No viewer identities are ever stored beyond the 90-day dedupe window or exposed; document the counting in the Datenschutzerklärung.
**6.2 Build progress & plans**
- Per vehicle: planned mods (§5.9) + built mods → **Build-Fortschritt** = built ÷ (built + planned) with a ring and "4 von 7 geplanten Mods verbaut". Optional milestone goal ("Ziel: Saison 2027").
- Owner prompts at the right moment: when a planned mod's target month arrives → gentle push "Ist das KW V3 schon verbaut? Trag es ein." (max 1 per week).
**6.3 Weekly recap** — opt-in (default on, easy off) push/e-mail every Sunday 18:00: views, scans, new followers, upcoming Treffen nearby, due maintenance. Skipped when nothing happened.
**6.4 Milestones** — quiet badges on the profile, real only: "Erster Build", "100 Aufrufe", "10 Mods", "Sticker aktiviert", "War bei 5 Treffen", "Hilfreich im Forum (10×)". Toast + success haptic once; no leaderboards, no streak pressure.
**6.5 Existing loops** stay: follow members/vehicles, build updates, reactions, mentions, maintenance/HU reminders, event reminders, forum replies.
All notifications obey SET-09 categories, quiet hours and the per-category push limits (max 3 engagement pushes/week per user).

---

## 7. Forum (Community) — moderated discussions
**7.1 Structure** — categories (admin-managed, ordered): Technik & Tuning (sub: Motor, Fahrwerk, Bremsen, Räder & Reifen, Abgasanlage, Elektronik), Marken & Modelle (auto-generated per make), Kaufberatung, Werkstätten & Teile, Treffen & Regionen (Bundesländer), Pflege & Detailing, Off-Topic. Thread = title (≤ 120), body (Markdown subset: bold, italic, lists, links), up to 6 photos, optional attached vehicle or mod or product, tags.
**7.2 Screens** — FOR-01 Forum home (Entdecken › Forum): search, category chips, sort *Aktiv · Neu · Unbeantwortet · Gelöst*, thread rows (title headline, category + vehicle chip, last activity, reply count tnum, "Gelöst" badge) · FOR-02 category · FOR-03 thread (original post, replies with one level of nesting, "Hilfreich" votes (count visible — useful for sorting), author can mark the best answer "Gelöst", subscribe, share, report) · FOR-04 composer (sheet: title, category, text, photos, attach vehicle; **"Ähnliche Themen"** suggestions appear while typing the title to avoid duplicates) · FOR-05 my threads & subscriptions.
**7.3 Rules & moderation** — new accounts (< 3 days or no verified e-mail) post into pre-moderation; rate limits (threads 5/day, replies 60/day); keyword rules (ADM-23); report → DSA pipeline with statement of reasons; staff tools: pin, lock, move, merge, hide, ban from forum; admin SplitQueue gets a Forum queue. Notifications: replies to my thread/subscription, mentions, "deine Antwort wurde als Lösung markiert".
**7.4 Integration** — vehicle profile shows linked threads; mod and product pages show "Diskussionen"; Home "Gerade im Forum" module (3 active threads); search includes threads.
- Flag `forum` (on). Data: `forum_categories`, `forum_threads`, `forum_posts`, `forum_votes`, `forum_subscriptions`. Seed 25 realistic sample threads with replies on staging (badged "Beispiel").

---

## 8. AI — natural, simple, optional (uses the existing Laravel AI SDK features from Phase 3)
Principle: AI appears as a small, clearly labelled suggestion **inside an existing step**, never as its own section, never a chatbot tab, always editable, always skippable. Label "KI-Vorschlag" (AI Act transparency), no sparkle icons. Flag per feature; everything works without an AI key.
1. **Wizard:** after choosing make/model/generation → "Daten übernehmen?" fills typical factory specs (provenance "Herstellerangabe (KI-Vorschlag)") for the member to confirm.
2. **Mod editor:** typed text "kw v3" → matched product "KW Variant 3 Gewindefahrwerk" from the catalogue (catalogue match first, AI only for normalisation).
3. **Description helper:** "Text vorschlagen" writes a short build description from specs + mods in German; member edits before saving.
4. **Forum:** similar-thread suggestions while writing (§7.2) and a 3-line "Zusammenfassung" on long threads (> 20 replies).
5. **Search understanding:** "e46 mit kw fahrwerk unter 300 ps" → filters (existing query understanding).
6. **Moderation assist (admin only):** risk score and suggested reason template in the queues; a human always decides.
Cost control: caching, per-user daily limits, provider key only in server `.env` (owner action: AI key from the client — optional; without it the features hide).

---

## 9. Admin bug — "cannot publish features"
- **Reproduce first** on staging as the client's owner account: Feature-Flags (ADM-36), Remote-Config (ADM-37), Content/Home-Kuration publish (ADM-29/35). Capture network responses and `storage/logs`.
- Likely root cause to check first: **four-eyes approval** on production-impacting flags while the organisation has only one active owner → the change waits forever for a second approver and nothing tells the user. Also check: CSRF/session expiry, validation errors not shown, permission atoms missing for the owner role, config-version draft → publish transition, cache not cleared after publish, app-config ETag not refreshed.
- **Fix properly:** clear status UI ("Wartet auf Freigabe durch eine zweite Person" with who can approve), and when **no second eligible approver exists**, allow the owner to publish with a mandatory reason as a recorded **Owner-Override** (audit + e-mail to all owners) — configurable in Governance settings. Toast on success, clients pick up the change within 5 minutes (app-config poll) or immediately via a cache bust.
- Regression tests (Pest + Playwright A7: owner toggles a flag and publishes, member app reflects it).

---

## 10. Go-live: client hosting (ALL-INKL) + domain joinspeedclub.com + e-mail
**10.1 Facts from the client**
- Hosting: ALL-INKL.COM (KAS). Domain: **joinspeedclub.com** (hosted there). Sender address: **no-reply@joinspeedclub.com**.
- Mailbox provided: info@joinspeedclub.com — SMTP `w021473b.kasserver.com`, port **465**, encryption **SSL**, authentication password, username = mailbox login (KAS account name or full address — verify which works). **Credentials are typed into the server `.env` by the owner, never pasted into chat or commands.**
**10.2 What the agent does (with owner help where marked)**
- Verify the ALL-INKL plan capabilities (owner reads them in KAS or the agent asks the owner to paste the plan name): PHP version selector (use the newest supported by Laravel 13), MySQL, SSL (Let's Encrypt in KAS), **SSH/SFTP availability**, **cronjob type** (ALL-INKL cronjobs typically call a **URL** — verify). Record in ADR-503.
- If cronjobs are URL-based: add a secured endpoint `GET /internal/cron/{token}` (long random token from `.env`, IP-independent, rate-limited, returns 204 quickly, runs the existing inline scheduler) and document the KAS cronjob (every minute or the shortest interval allowed). Keep the CLI command for SSH hosts.
- Domain document root → `web/public` (KAS → Domain → Ziel/Pfad), HTTPS forced, HSTS after verification.
- Database in KAS, `.env.production` from `.env.example`, `APP_URL=https://joinspeedclub.com`, `PASSKEY_RP_ID=joinspeedclub.com`, mail settings (MAIL_MAILER=smtp, host/port/encryption above, MAIL_FROM_ADDRESS=no-reply@joinspeedclub.com, MAIL_FROM_NAME="SPEED CLUB"). If ALL-INKL refuses sending as no-reply@ from the info@ login, the owner creates no-reply@ as its own mailbox (preferred) or an alias in KAS, and DKIM + SPF are enabled in KAS; test with mail-tester-style checks (score ≥ 9/10).
- Deploy method: SSH/SFTP if available (key auth), else the packaged zip uploaded via KAS file manager/FTP with exact steps in `docs/DEPLOY_ALLINKL.md` (German + English, screenshots placeholders, every click).
- **Production switch-over:** QR/Sticker base URL = `https://joinspeedclub.com/c/{code}` (staging codes are re-issued on production; nothing printed yet), universal/app links + `.well-known` on the new domain, OG images, sitemap, robots, Google OAuth redirect/JS origins, FCM, app builds with `-Target production`.
- Flags for production per 09 §8.18; `editorial_samples` stays **off** in production (real content only); demo data never reaches production (the demo seeder refuses).
- Smoke test after deploy: `/`, `/app`, a public vehicle page, sign-in with e-mail code (real mail arrives), password reset mail, admin login with 2FA, scheduler heartbeat, `php artisan speedclub:doctor`.
**10.3 Google (client account info@joinspeedclub.com)** — the owner signs in once and adds the developer's own Google account as **Owner** in Google Cloud IAM and Firebase; then the client changes the shared password and enables 2-step verification. Then: Google Cloud project "SPEED CLUB" → OAuth consent screen (external, app name, logo, support e-mail, privacy URL, authorised domain joinspeedclub.com) → OAuth clients Web (JS origin + redirect on joinspeedclub.com and staging), Android (package + SHA-1 of staging and release certs from `apksigner`), iOS (later) → Firebase project linked → Android app registered → FCM v1 service account uploaded to Expo push credentials. Client IDs go into config/`.env` (public IDs are fine in `EXPO_PUBLIC_*`); service account JSON stays out of git.

---

## 11. Screens and IDs added/changed in this phase
STK-01…07 (Sticker hub, detail, placement, stats, designer, order, design history) · SHOP-01/02 · FOR-01…05 · INS-01 · VEH-01 (one scroll) · VEH-08 (full history) · HOME-01 header (Nachrichten + bell) and new modules ("Nächste Treffen", "Gerade im Forum") · ADM: Shop-Produkte, Sticker-Designs, Forum-Moderation (+ Kategorien), Insights overview, Owner-Override setting. Every new screen follows 09 §5 components, §7 blueprint standards and the skill; flagship ★ this phase: STK-05, VEH-01, SHOP-01, FOR-03.

---

## 12. Modules (in order; lanes as 09 §15; max 2 builders)
**M5.0 Pre-flight** — read 09 §0 + this file; gates of the last phase green; baseline screenshots of changed routes; HANDOFF Phase 5 table; ADR-501…506 (§14); owner actions (§13).
- [ ] Phase-4 state recorded (if Phase 4 modules are still open, finish the ones these modules depend on first and note it).
**M5.1 Admin publish bug** (first, it blocks the client) — §9; A7 green.
**M5.2 Navigation 3.0** — §1; E2E nav + screenshots all platforms.
**M5.3 Vehicle profile one scroll** — §5; design-qa ≥ 4 (aim 5); scroll performance budget (< 5 % janky frames on Android).
**M5.4 Sticker rename + hub + designer + exports + order link + stats** — §2; QR decode test for every template × option combination (automated); print PDF checked at 100 % scale; design-qa ≥ 4 (aim 5).
**M5.5 Shop** — §3; external checkout opens correctly on iOS web, Android, desktop; design-qa ≥ 4.
**M5.6 Events page polish** — §4 (on top of 09 §8.7); F12 still green + gallery/check-in tests.
**M5.7 Engagement** — §6 views (dedupe, bot filter, aggregation job), INS-01, build progress & plans, weekly recap, milestones; Pest tests for dedupe and privacy (no viewer identities in any response).
**M5.8 Forum** — §7; F15 (create thread → similar-thread hint → reply → mark solved → notification → report → staff hide) green; moderation queue.
**M5.9 AI helpers** — §8; each feature behind its flag, works with a fake provider in tests, hidden without a key.
**M5.9a Plate blur, user decides** — §16.1; plate-blur leak test green.
**M5.9b STREET DEX** — §16.2; F16 green; privacy tests (no coordinates stored, Ghost mode, delayed/aggregated map).
**M5.9c Build Journey + Build Score** — §16.3; F17 green; score never rewards power/speed/noise/money.
**M5.9d Supporting system** — §16.4 (XP/levels/badges, hidden badges, scan alerts, Car of the Day, Founding Member numbers, invite codes, share card).
**M5.9e Season Wrapped engine** — §16.5; staging demo Wrapped renders and shares.
**M5.10 Demo dataset refresh** — extend the showcase seeder (stickers in several designs, shop products, forum threads, views history for insights, planned mods) so every new page is full on staging; zero-error crawl (guest, member, admin; WebKit iPhone + desktop) — paste the summary.
**M5.11 Go-live preparation on ALL-INKL** — §10; `docs/DEPLOY_ALLINKL.md`; cron endpoint; mail test; deploy to production (or package + owner steps); smoke tests; production flags.
**M5.12a Phase-4 carry-overs** — §17: member web Lighthouse on `/app` within budget (ADR-473), Home with business features within budget (BL-18), so `businesses` can be switched on.
**M5.12 QA & release 2.1.0** — full visual matrix of changed routes, design-qa summary (rubric ≥ 4, anti-AI checklist), design-lint strict 0, security review of new surfaces (forum XSS/markdown sanitising, view-count abuse, sticker custom text, cron token, Shopify links, owner override), performance notes, APK `-Target production` (or staging if production is not live yet), client preview page in German (before/after of every changed screen + short "Was ist neu"), HANDOFF "PHASE 5: COMPLETE", tags.

---

## 13. Owner actions (non-blocking)
1. Enter SMTP + DB + app secrets into the production `.env` yourself (never in chat). Ask the client to create **no-reply@joinspeedclub.com** as a real mailbox (or confirm sending as alias works) and to enable DKIM in KAS.
2. Google: sign in once with info@joinspeedclub.com, add your own Google account as Owner in Google Cloud and Firebase, then ask the client to **change that password and turn on 2-step verification** (it was shared over WhatsApp).
3. ALL-INKL: tell the agent the plan name / whether SSH is included; create the database and the KAS cronjob when the agent gives the exact values; ask the client to change the members-area password after setup.
4. Shopify: store URL + product/variant ids for "Car-Sticker" and later merch (optional Storefront API token).
5. AI provider key (optional) — the client decides; features hide without it.
6. Still open from Phase 4: Apple Developer account, Google Play account, legal review, real community builds.

---

## 14. ADRs to record
501 Navigation 3.0 (Shop tab, Nachrichten in header, Treffen/Forum under Entdecken) · 502 Shop with external Shopify checkout + local catalogue driver · 503 ALL-INKL hosting specifics (cron via URL if applicable, deploy method, mail sender) · 504 Sticker naming + designer + print pipeline · 505 One-scroll vehicle profile with section index · 506 Forum scope + moderation rules + visible "Hilfreich" counts in the forum only · 507 Owner-override for four-eyes when no second approver exists · 508 Gift features on our stack (§16 mapping table) · 509 Plate blur pipeline (blurred derivative is the only public source).

---

## 15. Exit gate (evidence shown in the conversation)
1. `scripts/verify.ps1 -Phase 5` exited 0 and printed its report path (includes everything from Phase 4 plus F15, F16, F17, A7, the plate-blur leak test, the sticker QR-decode suite, the zero-error crawl, and Lighthouse on `/app` within budget).
2. `docs/reports/design-qa/phase-5/summary.md` PASS: 0 open High/Medium, every changed/new screen ≥ 4 on all nine axes; `node scripts/design-lint.mjs --strict` printed 0 violations.
3. `docs/reports/security/phase-5.md`: 0 open Critical/High.
4. Admin publish bug: A7 green and the root cause written in HANDOFF.
5. Production on joinspeedclub.com serves 2.1.0 (curl of `/api/v1/app-config`) and a real e-mail code arrived — or, without access, the deploy package + `docs/DEPLOY_ALLINKL.md` exist and HANDOFF lists the exact owner steps.
6. APK path + SHA-256 + SPEED CLUB signer for 2.1.0.
7. `docs/reports/phase-5/summary.md` + `docs/reports/phase-5/client-preview/index.html` (German, before/after).
8. HANDOFF "PHASE 5: COMPLETE"; `git status` clean; tags `phase-5` and `v2.1.0-rc.1`.

---

## 16. Gift features (client-approved 2026-11-14)
The owner promised the client three flagship features and a supporting system as a free gift; the client approved them. The research behind them was written for a different stack — **map it to ours, never add new infrastructure:**

| Research said | We use |
|---|---|
| Node/TS backend, PostgreSQL, pg_trgm | Laravel 13 actions/jobs/policies, MariaDB 10.11, our existing search layer (FULLTEXT + query understanding) |
| pg_cron / node-cron | Laravel scheduler via the secured cron endpoint (§10.2); every heavy job chunked + resumable, ≤ 50 s per run |
| Next.js QR page | existing Blade `/c/{code}` → `/v/{slug}` (printed URLs never change) |
| react-native-vision-camera | expo-camera `CameraView` barcode scanning (verify on SDK 58) |
| notifee, react-native-firebase | expo-notifications, our existing Expo push |
| Cloudflare R2, Hetzner VPS | our media disk with the storage abstraction kept S3-ready; hosting stays as decided |
| Skia / view-shot cards | existing GD share-card pipeline + react-native-view-shot |
| MapLibre + OpenFreeMap | as already specified (09 §8.7) |

**Safety rules for all of §16:** no speed, 0–100, top-speed or lap-time boards; nothing live; no guilt pushes or fake notifications; every engagement push has an off switch; max 1 social push per day, quiet hours 22–08 (EU Digital Fairness Act readiness). DE + EN strings, design skill applies; Dex reveal and score gauge are flagship ★.

### 16.1 Plate blur — the user decides (client request)
On every photo upload and in the photo editor: switch "Kennzeichen unkenntlich machen", **default ON**, with a suggested blur area. Automatic on-device plate detection only if a maintained Expo-compatible module works on SDK 58 / New Architecture (spike, ADR-509); otherwise the user drags/resizes blur rectangles (extend the GAR-08 blur tool). Public variants, OG images and share cards are always derived from the blurred version; the unblurred original is deleted from the server once blur is applied. Test: no public URL ever serves an unblurred version when blur is on.

### 16.2 STREET DEX (flagship)
- In-app scanner (SCAN button in Garage and Start headers) reads a member's sticker → the car becomes a card in the user's Dex: Dex number (registration order), rarity, "First Spotter" foil for the first 3 spotters, set progress.
- **Rarity is rule-based** from our data, recomputed nightly: Street · Tuned · Rare · Legend · Ghost (owner opt-in: hidden from search, revealed only by an in-person scan).
- **Sets:** JDM Legends, brand sets, city sets, season sets (Saisonstart/Saisonende).
- **Validity:** only in-app scans count as spots; web scans are views only. Server checks: one spot per car per user per 24 h, rate limits, account age.
- **Owner:** grouped, delayed alerts ("Dein EK9 wurde heute 4-mal in Düsseldorf gespottet"), "Gespottet von 112 Leuten in 9 Städten", "Street Famous" badges at 10/50/100/500.
- **Privacy (hard rules):** location permission only when scanning and optional; the device turns GPS into a city name, only the city is sent, coordinates are never stored; no per-car pins; public heat map by city only, ≥ 24 h delayed, ≥ 5 spots per area; owner switches Ghost mode / hide spot cities / pause spotting; no night-time cities for a single car; account deletion removes all spots.
- **Screens:** DEX-01 Dex home (grid, "???" silhouettes, progress) · DEX-02 scanner (corner frame, haptic) · DEX-03 spot reveal (card flip on spring tokens, reduced-motion crossfade) · DEX-04 car card · DEX-05 sets · DEX-06 owner spot stats. Dex is reachable from Profil.
- **F16:** scan → spot → Dex card → owner grouped alert → privacy assertions.

### 16.3 Build Journey + Build Score
- Journey = the existing timeline + before/after, plus a **"TÜV-eingetragen"** flag per mod.
- **Build Score 0–1000**, formula shown to users: completeness 300 · mod documentation 300 (bonus for registered parts) · community 250 (unique reactors via our private reactions, capped per user; spots received) · journey 150. **Never** points for horsepower, speed, loudness or money.
- Stages 1–5, tachometer gauge animated on first view, "Nächstes Upgrade" checklist with real progress from signup (planned mods from §5.9 feed it). Rank by chassis/generation and by Bundesland ("#4 von 61 EK9 in Deutschland"), refreshed nightly. Replaces the §6.2 progress ring.
- **F17:** add mod → nightly recompute → rank change → share card.

### 16.4 Supporting system
XP, levels and badges with **fixed rules only** (XP for real actions, daily cap, no XP for spam; titles from "Street Rookie" to "Kaido Legend", none referring to speed on public roads) · hidden badges shown as "???" with a hint, rules stored in the DB, awarded retroactively (replaces §6.4) · scan alerts + counter (merged with §6.1 insights) · **Car of the Day** at 18:00, rule-based, rotating regions, no repeats, push only for opt-in · **Founding Member #0001–#1000** for real production signups only (demo/staging accounts never get a number) · invite codes (badge for both sides) · share card 9:16 with car, specs, Build Score and QR (extend VEH-07).

### 16.5 Season Wrapped (engine now; first real release at Saisonende 2027 and in December)
Nightly aggregation into a per-user payload; story player with 8–9 cards (spots, rarest find, scans received, score progress, top mod with before/after, crew stats when crews exist, rule-based "Build Spirit", percentile, final share card with QR); rendered on device and shared via the share sheet; own data only, cities only; admin preview; a full demo Wrapped on staging from the showcase data.

### 16.6 Not in Phase 5 (Phase 6 backlog in HANDOFF)
Build Battles, Crews, city leaderboards, gentle weekly streak with off switch, Wallet pass + widgets, dyno/cost tracker.

## 17. Phase-4 carry-overs
- Member web Lighthouse on `/app` (ADR-473): reach the 09 §12 budget (code splitting of heavy routes, image priorities, font preloads, fewer blocking requests). Don't change the budget.
- Home with business features (BL-18): about 0.1 s over budget — fix before `businesses` is switched on.
- Demo refresh (M5.10) includes §16 data: spots across 12 German cities, sets in progress, scores and ranks, badges, Car of the Day history, one demo Wrapped.
