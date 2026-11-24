# Client round 5 (2026-11-22) — the client's open points after round 4

Owner order: (1) the client's demo login on staging + a member smoke on staging, (2) his open points a–f, (3) gates, staging, smoke as guest + member, screenshots, then the remaining Phase 5 work. Hard rules unchanged (project rules, 10 §16): never weaken a gate, never print, commit or push secrets.

| ID | Client's words (via the owner) | Ruling |
|---|---|---|
| R5-1 | "The client's demo login stopped working" | Finding on staging (2026-11-22): all 42 demo accounts (`*@speedclub.test`) already sign in with DEMO_MEMBER_PASSWORD of the staging `.env` (API and the real sign-in UI, WebKit 390); `sebastian.demo` has no failed sign-in since 2026-11-15. New idempotent `php artisan speedclub:demo-passwords [--dry-run]` (local/staging only, `Showcase::assertEnvironment`): puts DEMO_MEMBER_PASSWORD on every live demo account whose hash does not match (a matching hash stays, so its sessions stay), lifts the progressive sign-in delay of these accounts (`LoginThrottle` by account and by address), one audit row when something changed, never prints the password. Run by every staging deploy after the seeders. Member smoke `scripts/staging-smoke.mjs` reads the password from the environment only |
| R5-2a | "Car profile hero image on desktop: smaller" | Done in R4-1.3 (VEH-01 desktop hero at most 50 % of the window and ≤ 480). Check with staging screenshots at 1280/1440 |
| R5-2b | "Performance specs (PS, Nm, 0–100, weight) slightly smaller on mobile" | The phone's SpecStrip numeral goes one step down: new type role `hero.numeral.xs` (32/32, tabular, max scale 1.3, ADR-536) for the strip on a phone (< 768) in the app and on WEB-01; tablet page `hero.numeral`, desktop card `hero.numeral.s` unchanged. The Build Score is not touched |
| R5-2c | "The owner's car description gets a clear label: Beschreibung" | Done since client round 1 (CF-3): VEH-01 and WEB-01 head the description with "Beschreibung" / "Description". Check with screenshots |
| R5-2d | "Image swiping bug in the vehicle gallery and viewer" | Reproduce on WebKit iPhone, Android Chrome and the APK (snap, index, conflict with page scroll / back gesture, pinch-zoom reset), fix the root cause, add a gallery swipe e2e test |
| R5-2e | "Story / share card: customise it; square 1:1 crops text/QR" | VEH-07 2.0, contract below |
| R5-2f | "Forum is still missing for the client" | Built in M5.8 and on staging since 2026-11-16 (flag `forum` on): Entdecken › Forum on phones, "Forum" in the sidebar from 1280, the Start module "Aktiv im Forum". Check it on staging as guest and member, screenshots; if it is hard to find, make the entry visible |

## VEH-07 2.0 share card contract (R5-2e)

`GET /api/v1/vehicles/{id}/share-card.png` keeps its route, auth, throttle and caching rules (ShareCards: the default card is the stored public PNG at `share_card_url`; any other choice is drawn for this viewer, cached privately, never given a URL). New query parameters, all optional; the defaults draw exactly the stored card:

| Param | Values | Default | Notes |
|---|---|---|---|
| `format` | `story` 1080 × 1920, `square` 1080 × 1080 | `story` | unchanged |
| `template` | `band`, `poster`, `frame` | `band` | `band` = today's card (square: photo on top, band below; story: photo edge to edge, data at the bottom). `poster` = photo edge to edge on both formats under a dark scrim, the name large at the top of the safe area, data and QR at the bottom; always dark. `frame` = the photo inset on a solid ground with a caption block (name, data, text, QR); takes `theme` |
| `theme` | `dark`, `light` | `dark` | square `band` and both `frame` formats; ignored elsewhere |
| `photo` | media id of one of the build's public photos | cover | unchanged |
| `zoom` | 1.00 – 3.00 (two decimals) | 1 | crop: 1 = the largest window of the template's photo box aspect that fits the photo |
| `x`, `y` | 0 – 1 | the photo's focal point, else 0.5 | crop: the centre of the window in the photo; the server clamps the window inside the photo (never letterboxes) |
| `show` | subset of `score`, `dex`, `specs`, `mods`, `username`, `qr` (bracketed or comma list; empty `show=` = none) | `score,dex,specs,username,qr` (what the build has) | `mods` is new and off by default: "12 Mods" plus up to two of the build's public mods (brand + short name) that fit on the line, never cut mid-word. `username` still needs the owner to show themselves (ADR-148 a) |
| `text` | ≤ 60 characters after trim, one line | none | the member's own line. Letters, digits, spaces and common punctuation the card fonts cover (Latin, Latin-1, Latin Extended-A, `–—„“”‚‘’…·•`); anything else (emoji, control characters, line breaks) → 422 `text` "Nur Buchstaben, Ziffern und Satzzeichen, keine Emojis." Checked against the keyword rules (KeywordRules): a block rule → 422 `text` with the rules' generic message |

**Photo boxes** (the crop UI shows exactly this aspect; Pest and Jest both assert this table):

| template | square photo box | story photo box |
|---|---|---|
| `band` | 1080 × 600 | 1080 × 1920 |
| `poster` | 1080 × 1080 | 1080 × 1920 |
| `frame` | 984 × 600 | 984 × 1080 |

**Layout rules (every template, both formats) — the square 1:1 fix:**
1. Safe area: on the square every text, the gauge and the QR keep 64 px from every edge; on the story nothing but the photo and the scrim lies in the top 250 px or the bottom 250 px (the story apps' own bars cover them).
2. The name never loses letters while it fits in two lines: it shrinks from the display size to a minimum, then wraps at a word boundary onto a second line, and only then ends in "…" (test name: "Corolla Levin/Trueno AE86", "Skyline GT-R R34 V-Spec II Nür").
3. The QR (when shown) keeps its quiet zone, never overlaps anything and is at least 200 px on the square and 240 px on the story; every template × format reads back with the server's QR reader in Pest.
4. No element overlaps another at any combination of `show`, `text` and the longest strings (title, specs, @username of 30 characters, 60-character text).
5. The PNG is the one output: the app shows it at its exact aspect without cropping (`contentFit` contain), shares and saves the same bytes on iOS web, Android, the APK and desktop.
6. Legibility floor (lead review r1, 2026-11-22): on the 1080-wide canvas no line is drawn below 26 px (the name never below 44 px; the gauge's own captions below 22 px), on every template, format and combination. The one accepted exception: an @username wider than its column at the floor (only near-30-character names of wide letters, e.g. "@wwww…") ends in "…" on the story layouts. The square `band` carries the Build Score gauge on the photo's lower right corner on its own disc (as `frame`), so the band's text column runs up to the QR; the band is 480 high (photo box 1080 × 600). The `frame` photo boxes are 984 × 600 (square) and 984 × 1080 (story), so both captions have room (the story's above the bottom 250 px).

`ShareCards::VERSION` goes to 6 (every stored card is redrawn with the fixed layout). The response for a vehicle without a usable photo, a private build and a guest are unchanged.

**App (VEH-07):** format (Story/Quadrat) → template picker (three thumbnails of the templates with the chosen photo, radio group) → photo picker (existing) → crop (the photo in the template's box aspect: drag to move, pinch or "−/+" buttons to zoom, "Zurücksetzen"; keyboard arrows on web; reduced motion: no momentum) → what the card shows (chips: Build Score, Dex-Nr., Daten, Mods, @username, QR-Code; only what the build has) → own text (field, 60 characters, counter, server 422 mapped onto the field) → theme where the template takes one. The preview updates at once for the crop (local) and redraws the server card 400 ms after the last change; "Standard" restores the stored card. Actions: "Teilen" everywhere; "Speichern" on the web (download) and natively (save to the photo library through `expo-media-library`, permission asked on first use, a denied permission gets a toast with "Einstellungen"). All states (loading skeleton at the card's aspect, offline, error + retry, unavailable), DE + EN, 200 %, three themes, 360–1440, reduced motion.
