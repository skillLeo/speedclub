# SPEED CLUB — Phase 5 "Client round 1" (spec draft, awaiting owner approval)

> **Status: DRAFT — not approved, nothing in this file is built yet.** The owner asked for the spec first (2026-11-14); building starts only after explicit approval.
> **Precedence:** `01_CLIENT_BRIEF.md` → `09_PREMIUM_2_0.md` → **this file** → 02…08 → DECISIONS → HANDOFF. Where §16 conflicts with 09 §3.2 "still never" (rankings, XP/levels/badges), §16 wins because the client approved these features (ADR-472). Everything else in 09 stays binding.
> **Phase 4 first:** Phase 4 (release 2.0.0) is finishing. Phase 5 starts after the `phase-4` tag.

## 0. Stack and hosting (fixed)

- **Stack stays:** Laravel 13 + MariaDB/MySQL (prod MariaDB ≥ 10.6 or MySQL ≥ 8, `05_ARCHITECTURE` §2) + Expo SDK 58 (iOS, Android, member web) + Inertia/Vue admin. Shared hosting, PHP + MySQL only.
- **Never add:** Node.js servers, PostgreSQL, Next.js, Cloudflare R2/Workers, Hetzner, notifee, react-native-vision-camera, react-native-firebase.
- **Hosting:** staging stays on **Hostinger** (SSH, hPanel cron). Production host is open (OA-30); it may become **ALL-INKL Private** (no SSH, no cron jobs) later. No deploy changes in Phase 5.
- **Printed sticker URLs `/c/{code}` never change.**

| Research idea | SPEED CLUB equivalent |
|---|---|
| Node/TS backend | Laravel actions, jobs, policies, FormRequests, Resources |
| pg_cron / node-cron | Laravel scheduler, triggered by **both** the hPanel cron (`speedclub:schedule-inline`) **and** the secured `/internal/cron/{token}` URL (M5.0) |
| pg_trgm | existing search (MariaDB FULLTEXT + our query layer) |
| Next.js QR page | existing Blade `/c/{code}` → `/v/{slug}` |
| QR scanner | `expo-camera` `CameraView` barcode scanning (verify on SDK 58; new dependency → lead approval) |
| Local notifications / push | `expo-notifications` (installed) / our existing Expo push + Web Push |
| Image storage | existing media disk behind the storage abstraction (S3-compatible later stays possible) |
| Share / Wrapped cards | existing GD share-card pipeline (`ShareCardCanvas`, VEH-07) + `react-native-view-shot` (new dependency → approval) |
| Maps | MapLibre + OpenFreeMap, tap to load (ADR-411/449) |

## 1. Modules

| ID | Module | Notes |
|---|---|---|
| M5.0 | Cron dual trigger + resumable jobs | §15 |
| M5.1–M5.8 | (reserved) | the client-round-1 list referenced elsewhere is not in this repo yet; add here when it arrives |
| M5.9a | Plate blur, the user decides | §16.2 |
| M5.9b | STREET DEX ★ | §16.3 |
| M5.9c | Build Journey + Build Score ★ | §16.4 |
| M5.9d | Supporting system (XP, badges, alerts, Car of the Day, founding numbers, invites, share card) | §16.5 |
| M5.9e | Season Wrapped (engine) | §16.6 |
| M5.10 | Demo refresh | extended by §16.7 |
| M5.11 | Phase 5 gate + release | `verify.ps1 -Phase 5`, §16.8 |

## 15. M5.0 Cron dual trigger (owner decision 2026-11-14)

- One scheduler, two triggers: the existing hPanel cron calling `speedclub:schedule-inline` **and** `GET|POST /internal/cron/{token}` for hosts without cron (e.g. cron-job.org every minute).
- `/internal/cron/{token}`: token from env (`INTERNAL_CRON_TOKEN`, ≥ 32 random bytes), constant-time compare, 404 on mismatch (no oracle), throttled, no session/cookies, `Cache::lock` so two triggers never overlap (the second answers 202 "already running"), structured log line per run, never exposes output.
- **Every job is chunked and resumable** with a wall-clock budget: a run stops starting new chunks at 45 s and finishes ≤ 50 s; cursors/progress are stored (DB or cache) so the next minute continues. Applies to the existing heavy jobs (sitemap, OG prune, media recompress, KPI snapshot, digests, Web Push batches) and every new §16 job (spot aggregation, scores, ranks, Wrapped).
- Tests: both triggers run the same tasks; lock prevents overlap; a job over budget yields and resumes; wrong token = 404 with no timing difference beyond noise.
- No deploy changes; DEPLOY.md documents the optional URL trigger.

## 16. Gift features (client-approved)

### 16.1 Rules for everything in §16

- **Never:** speed, 0–100, top-speed or lap-time boards; anything live (positions, "is here now"); guilt pushes; fake notifications or fake counts; random or paid rewards.
- **Every engagement push has its own off switch** (SET-09 category) — EU Digital Fairness Act readiness. Engagement pushes: max 1 social push per day per member, quiet hours **22:00–08:00**.
- **Counts honesty:** samples never count as real (ADR-412/466); demo/staging accounts never get founding numbers.
- **Design:** speedclub-design skill; **Dex reveal** and **score gauge** are flagship ★ (09 §7 quality bar, design-qa ≥ 4, flagship target 5 on Hi/Ph/Ty). Spring tokens only, reduced-motion crossfade.
- **Copy:** all new strings DE + EN; no title, badge or copy may refer to speed or racing on public roads.
- **Privacy:** GDPR Art. 6(1)(b) for spots/score; data export (Art. 15) and account deletion cover every new table.

### 16.2 M5.9a Plate blur — the user decides (client request)

- Every photo upload and the photo editor (GAR-08) get a toggle **"Kennzeichen unkenntlich machen"**, default **ON**, with a suggested blur area.
- **Detection spike (ADR):** use on-device automatic plate detection only if a maintained Expo-compatible module works on SDK 58 / New Architecture. Otherwise the member drags/resizes blur rectangles (extend the existing GAR-08 blur tool); the suggestion is a default rectangle in the lower third.
- Public variants are always produced from the **blurred master**. Once blur is applied, the **unblurred original is deleted from the server**. Consequence: `media:recompress` (ADR-464) must re-encode from the blurred master, never from a deleted original — amend ADR-464.
- OG images, share cards (VEH-07) and Wrapped cards use only the blurred version.
- **Leak test (gate):** with blur ON, no public URL (variants, OG, share card, `/c` → `/v`, API resources, admin previews) ever serves unblurred pixels; the original file is gone from disk.

### 16.3 M5.9b STREET DEX ★ (flagship)

**What.** Scanning a member's sticker **with the in-app scanner** adds the car to the scanner's Dex as a card: Dex number (vehicle registration order, never reused), rarity, **First Spotter** foil for the first 3 spotters, set progress.

**Rarity (rule-based, never random, recomputed nightly):**
- **Street:** common model in our data.
- **Tuned:** Build Score above a threshold (§16.4).
- **Rare:** fewer than *N* cars of this model/generation in the club (N in config).
- **Legend:** unique or very low count, or an owner-marked H-plate classic.
- **Ghost:** owner opt-in — the car is hidden from search, Discover and Dex browsing and only appears in a Dex after an in-person scan. The sticker URL `/c/{code}` keeps working (printed URLs never change); Ghost hides discovery, not the public page.

**Sets:** JDM Legends (curated list), brand sets, city sets ("Köln 7/10"), season sets (Saisonstart–Saisonende). Rules stored in the DB.

**Validity (server-checked):**
- Only scans from the in-app scanner count as spots; web scans of `/c/{code}` stay **views** (existing QR scan stats).
- One spot per car per spotter per 24 h; spotter cannot spot own cars; rate limits per member and per IP-less device key; minimum account age (config); the scan payload is the printed `/c/{code}` (no new QR format) plus an app-signed request (existing auth), server verifies the code is active.
- Suspicious patterns (many spots from one account in many cities in short time) flag for moderation, never auto-award.

**Owner side:** grouped, delayed alerts ("Dein EK9 wurde heute 4-mal in Düsseldorf gespottet."), at most 1 social push per day, quiet hours 22–08, off switch. Owner car page: "Gespottet von 112 Leuten in 9 Städten" — **visible to the owner only** (ADR-472).

**Privacy (hard rules):**
- Location permission only when scanning and optional (no location → spot without city).
- **The device turns GPS into a city name; only the city is sent; coordinates are never stored or transmitted.** City lookup is on-device from a bundled German city dataset (GeoNames cities ≥ 15 000 inhabitants, CC BY 4.0, credited) — no geocoding service call. `expo-location` is a new dependency → approval.
- No live data, no per-car pins on any map. Public heat map only by city, ≥ 24 h delayed, ≥ 5 spots per area.
- Owner switches: Ghost mode, hide spot cities, pause spotting.
- No night-time (22–06) cities shown for a single car.
- Account deletion removes all spots (as spotter and as owner).

**Screens:** Dex home (grid, "???" silhouettes, progress), scanner (red corner frame, haptic on success, camera permission primer AUTH-10), spot reveal ★ (card flip on spring tokens, reduced-motion crossfade), car card, sets, owner "Gespottet von …".
**Entry:** a SCAN button in the Garage and Start headers; Dex reachable from Profil.

**Data (MariaDB):** `dex_numbers` (vehicle_id, number), `spots` (id ULID, vehicle_id, spotter_id, city_code nullable, created_at, first_three), `spot_stats` (vehicle_id, total, unique_spotters, cities — job-maintained), `rarities` (vehicle_id, tier, computed_at), `dex_sets` (id, key, rule_json, season), `dex_set_progress` (user_id, set_id, progress, completed_at), owner settings on vehicles (`ghost`, `hide_spot_cities`, `spotting_paused`).

### 16.4 M5.9c Build Journey + Build Score ★

- **Journey** = the existing Verlauf timeline + before/after pairs, plus a **"TÜV-eingetragen"** flag per mod (no legality judgement — the member states it; 09 §3.2).
- **Build Score 0–1000**, formula shown to members:
  - completeness 300 (photos, specs, story);
  - mod documentation 300 (brand, photo, date per mod; bonus for registered parts);
  - community 250 (unique reactors from the existing private reactions — counted, capped per member, never shown as a public count; spots received);
  - journey 150 (timeline length, before/after pairs).
  - **Never** points for horsepower, speed, loudness or money spent.
- Stages 1–5 and a tachometer gauge ★ (animated on first view, spring tokens, reduced-motion final state).
- "Nächstes Upgrade" checklist with real, endowed progress from signup. Planned mods ("Pläne") stay and feed the checklist.
- **Rank** by chassis/generation and by Bundesland ("#4 von 61 EK9 in Deutschland"), refreshed nightly (M5.0 job), samples excluded. Bundesland from the member's home region (existing `home_region`).

### 16.5 M5.9d Supporting system

- **XP, levels, badges** with fixed rules only, no randomness. XP for real actions (add car/mod/photo, spot, attend a meet via RSVP), daily cap, no XP for spam-like actions. Titles from "Street Rookie" to "Kaido Legend" (none refers to speed or public-road racing).
- **Hidden badges** shown as "???" with a hint; rules in the DB (no app update); retroactive awarding for existing members.
- **Scan alerts + counter:** extends the existing QR-02 scan statistics and QR milestone notification.
- **Car of the Day** at 18:00 Europe/Berlin: rule-based (score, not featured before, rotating Bundesländer), no repeats; push only for opt-in members; relation to the existing "Build der Woche" decided in the ADR (keep both or merge).
- **Founding Member #0001–#1000:** real production signups only (order of verified sign-up); demo and staging accounts never get a number; extends the existing "Gründungsmitglied" badge.
- **Invite codes:** extend the existing invitation links; inviter and invitee both get a badge.
- **Share card 9:16** with car, specs, Build Score and QR — extend VEH-07 / `ShareCardCanvas`.

### 16.6 M5.9e Season Wrapped (engine now; first real release Saisonende 2027 and December 2027)

- Nightly, chunked aggregation (M5.0) into a `wrapped` payload per member (year, season, payload JSON, generated_at, viewed_at, shared_count).
- Story player with 8–9 cards: spots, rarest find, scans received, score progress, top mod with before/after, crew stats (only once crews exist — Phase 6), the rule-based **"Build Spirit"** card, percentile, final share card with QR.
- Rendered on device (`react-native-view-shot`), shared via the share sheet.
- Only the member's own data; cities only.
- Admin can generate a preview; staging shows a full demo Wrapped from the showcase data.

### 16.7 M5.10 demo data additions

Spots across 12 German cities, sets in progress, scores, ranks, badges, Car of the Day history, one demo Wrapped. All sample/demo content follows ADR-412 (badged "Beispiel", never counted as real, off in production).

### 16.8 Gate additions (`verify.ps1 -Phase 5`)

- **F17** STREET DEX: scan → spot → Dex card → owner grouped alert → privacy checks (no coordinates stored, Ghost hidden, night cities hidden, 24 h rule).
- **F18** Build Score: recompute → rank → share card.
- **Plate-blur leak test** (§16.2).
- (F16 is already the Phase 4 public-web flow, so the new flows are F17/F18.)
- **Security review** covers spot faking, rate limits, location privacy, Ghost-mode leaks, blurred images, the internal cron endpoint.

### 16.9 Not now — Phase 6 backlog

Build Battles, Crews, city leaderboards, weekly streak with off switch, Wallet pass + more widgets, dyno/cost tracker (beyond the existing private costs and "Prüfstand" source). Recorded in HANDOFF §6.

## 17. Open points before approval

1. **New dependencies** (lead approval, verify SDK 58 / New Architecture): `expo-camera`, `expo-location`, `react-native-view-shot`; plate-detection module only if the spike finds a maintained one.
2. **Brief change:** §16.4/§16.5 introduce public ranks, XP, levels and badges, which 09 §3.2 listed as "still never" ("follower gamification"). ADR-472 records the client approval; public like/reaction counts stay forbidden (spot and reaction counts are owner-only).
3. **Car of the Day vs Build der Woche:** keep both or merge.
4. **Effort:** the research estimates roughly 70–90 developer days for this scope; the module plan above is ordered so each part ships behind its own flag.
