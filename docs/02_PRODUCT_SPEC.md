# 02 — Product Specification

Read with `01_CLIENT_BRIEF.md` (wins on conflict). Screen IDs refer to `04_SCREEN_REGISTER.md`.

## 1. Product model (why every screen exists)

SPEED CLUB is **object-centric**: the **car** is the unit of content, not the post. The core loop (brief §11 "the bridge"):

**Physical car → QR sticker → public build page (no app needed) → owner profile → follow / message → discover similar builds → visitor joins and documents their own build → their own QR.**

Every screen must strengthen this loop. Home shows builds and build updates. Discover filters specs and modifications. The profile is a garage. Messages often start from a vehicle.

### 1.1 Product principles (settle debates with these)
1. **The car is the hero** — photography and specs lead; chrome recedes.
2. **Precision over decoration** — every number aligned, every unit explicit ("510 PS (375 kW)").
3. **Brand at the edges** — brush logo / katakana / grain only at brand moments, never inside workflows.
4. **Night-ready** — dark-first for car-meet lighting; light theme for daylight scans.
5. **One thumb** — primary actions in the lower half; destructive actions never adjacent to primary.
6. **Structured, not hashtags** — mods and specs are fields, therefore searchable.
7. **Calm social** — follow, save and message; **no like counts, no comment threads, no infinite Instagram feed**.

### 1.2 What "not an Instagram clone" means
| Instagram pattern | SPEED CLUB replacement |
|---|---|
| Infinite square photo feed | Home = build cards (4:3 photo + make/model + 3 spec chips + latest change) and build-update rows |
| Like counts | Follow member, save build ([SIGNATURE]); no public counts on cards |
| Captions + hashtags | Structured specs and modifications |
| Photo grid profile | Garage: vehicles first, Hauptfahrzeug pinned, specs visible |
| Stories/Reels | None. Outbound share cards only ([SIGNATURE]) |
| Comment threads | None in V1. Conversations happen in DMs |

## 2. Entities (summary — full schema in `05_ARCHITECTURE.md` §6)
| Entity | Key facts |
|---|---|
| **User / member** | email (unique), password (argon2id/bcrypt), username (unique, case-insensitive), display name, city, bio, avatar, cover, locale, theme, units, privacy settings, optional TOTP 2FA, sessions/devices, `restricted_*` flags, soft-delete + deletion queue |
| **Vehicle** | owner, status `draft│published│archived`, visibility `public│unlisted│private`, `is_main` (Hauptfahrzeug, max 1), slug + public_id, nickname, description (≤500), cover media, sort order |
| **Vehicle specs** (1:1) | make, model, generation, model year, engine (code + text), displacement cc, fuel, aspiration, power value + unit (PS│kW│hp) + provenance (factory│claimed│measured), torque Nm + provenance, drivetrain, gearbox, colour |
| **Modification** | vehicle, category, title, brand (catalogue or free text), part/model, part number, status `installed│planned│removed`, installed month/year, cost (private by default), legal status ([SIGNATURE]), notes (≤500), category fields (JSON validated by schema), photos (≤6) |
| **Build update** | auto-generated from spec/mod/photo changes (before → after diff) or an owner note; owner can hide; this replaces "posts" |
| **Media** | owner, attached to vehicle│modification│message│avatar│cover; EXIF/GPS stripped; WebP variants 320/640/1080/1600; blurhash; width/height; focal point; alt text; category (exterior│interior│engine│wheels│detail│other) |
| **QR code** | 1 active per vehicle; 8-char Crockford base32 code; status `active│revoked`; daily scan counts only (no IP, no identity) |
| **Follow** | member → member (no approval in V1) |
| **Save** ([SIGNATURE]) | member → vehicle bookmark |
| **Conversation / message** | 1:1 in V1; folder per participant `chats│requests`; accept/decline; mute/pin/archive; text│photo│vehicle-card messages; read state; reactions ([SIGNATURE]) |
| **Block** | bidirectional invisibility; ends conversations; blocks override everything |
| **Report / case / decision / appeal** | DSA notice-and-action; statement of reasons; appeal window 6 months |
| **Notification** | typed, grouped; in-app list + push + email per matrix (§7) |
| **Staff / role / permission / approval / audit event / config version / flag** | admin domain (`06_ADMIN_SPEC.md`) |

## 3. Business rules

### 3.1 Accounts
- **Registration** (AUTH-04): email, password, checkbox "Ich bin mindestens 16 Jahre alt" (required), checkboxes AGB + Datenschutz (unticked by default, required), optional marketing consent (separate, unticked). Store accepted document versions + timestamps.
- **Password policy:** ≥ 10 characters, not in a common-password list, not equal to email/username; strength meter shows rules, not a score. Hash with argon2id (fallback bcrypt cost 12 if argon2 unavailable on host).
- **Email verification** (AUTH-05): 6-digit code, 10-minute expiry, 5 attempts per code, resend cooldown 60 s, max 5 codes/hour. Unverified accounts can browse but cannot publish, follow or message.
- **Password reset** (AUTH-06/07): 6-digit code by email (works without deep links) + fallback link to `/app/reset-password`. Neutral response, no account enumeration. Reset revokes all other sessions and sends a security email.
- **Username** (AUTH-08): 3–24 chars, `a–z 0–9 . _`, must start with a letter or digit, no trailing dot, no `..`, case-insensitive unique, reserved list (admin, support, speedclub, api, app, c, v, u, legal, impressum, datenschutz, agb, help, hilfe, settings, login, register, staff, root, system, null, undefined, official …). Change max once per 30 days; old username redirects for 14 days.
- **2FA (member, optional):** TOTP + 10 recovery codes (SET-05); challenge at login (AUTH-11).
- **Sessions/devices** (SET-06): one Sanctum token per device (name, platform, app version, last used, city-level location **not** stored), revocable; web sessions listed too. New-device login → security email.
- **Guest browse:** Home, Discover, vehicle pages and member pages are viewable logged-out; Follow / Save / Message / Report trigger the **auth-required sheet** (sign in / create account) and return to the same place afterwards.
- **Deletion** (SET-13, WEB-05): explains consequences → re-auth → account deactivated immediately (profile/vehicles hidden, QR codes revoked) → hard delete within 30 days by scheduled job → confirmation email. Messages: the other participant keeps their copy, author shown as "Gelöschtes Mitglied".
- **Data export** (SET-12): ZIP (JSON + photos) generated by queued job, email link valid 7 days, max 1 per 24 h.

### 3.2 Garage & vehicles
- Max **20 vehicles** per member (config), **30 photos** per vehicle, **6** per modification; input files ≤ 15 MB; JPEG/PNG/WebP/HEIC (client converts HEIC → JPEG and pre-resizes to max 2560 px long edge before upload).
- **Add vehicle wizard** (GAR-03) autosaves a draft at every step. Publishing requires: make, model, model year, ≥ 1 photo. Everything else optional but drives the **completeness hint** ("Noch 3 Angaben bis zum vollständigen Build").
- **Catalogue:** make → model → generation → model year. "Nicht gefunden?" lets the member type a free-text make/model; it is saved on the vehicle and creates a catalogue request for admins (ADM-14).
- **Hauptfahrzeug:** at most one; first published vehicle becomes main automatically; changeable.
- **Visibility:** `public` (search, feed, profile, QR) · `unlisted` (only via link/QR; not in search/feed) · `private` (owner only; QR shows "Dieses Fahrzeug ist privat"). Default public.
- **Slug:** `/v/{make-model-generation}-{public_id}`; resolve by `public_id` (8 chars); if the text part differs → 301 to canonical.
- **Power:** store exactly what was entered (value + unit + provenance); display per user setting: default "PS (kW)" → "510 PS (375 kW)". 1 kW = 1.35962 PS; 1 hp = 1.01387 PS. Round PS/kW to integers for display. Provenance shown as a small label: Werksangabe / Besitzerangabe / Gemessen.
- **Build updates** are created automatically (debounced 10 min per vehicle) when: a mod is added/changed/removed, specs change, ≥ 3 photos are added, or the owner writes a note. Each shows a before → after diff (e.g., "Fahrwerk: Serie → KW V3 · −35 mm"). Owner can hide any entry.
- **Deleting a vehicle** revokes its QR (scans show "nicht mehr verfügbar"), removes it from search/feeds immediately, hard-deletes media within 30 days.

### 3.3 Modification categories and fields (seeded; admin-editable schema, ADM-15)
Common fields on every mod: title (auto: brand + model, editable), brand, model/part, part number, status (Verbaut / Geplant / Entfernt), installed (MM/YYYY), cost (private by default, toggle "Kosten öffentlich zeigen"), legal status ([SIGNATURE]: ABE · Teilegutachten · Eingetragen · Einzelabnahme · Nicht erforderlich · Unbekannt — label "Angaben des Besitzers, keine rechtliche Prüfung"), notes (≤ 500), photos (≤ 6).

| Key | DE label | Category fields |
|---|---|---|
| `wheels_tires` | Räder & Reifen | wheel brand, wheel model, diameter (in, 13–24, step 0.5), diameter rear (in, 13–24, step 0.5, only when it differs from the front, ADR-112), width front/rear (in, step 0.5), ET front/rear (−50…+70), bolt pattern (e.g. 5x120), finish/colour, staggered (bool), tyre brand, tyre model, tyre size front/rear (pattern `255/35 R19`), spacers front/rear (mm) |
| `suspension` | Fahrwerk | type (Gewindefahrwerk · Luftfahrwerk · Tieferlegungsfedern · Sportdämpfer · Serie · Sonstiges), brand, model, lowering front/rear (mm), adjustable damping (bool) |
| `exhaust` | Abgasanlage | type (Klappenauspuff/Valved · Catback · Downpipe/Turbo-back · Komplettanlage · Endschalldämpfer · Fächerkrümmer), brand, model, material (Edelstahl · Titan · Sonstiges), valves (bool) |
| `engine_performance` | Motor & Leistung | stage (Stage 1 · 2 · 3 · Individuell), tuner, software, turbo/compressor upgrade, intake, intercooler, fuel system, claimed power (PS) + claimed torque (Nm), measured on dyno (bool) |
| `brakes` | Bremsen | brand, model, front caliper pistons, front disc Ø (mm), rear caliper pistons, rear disc Ø (mm), pads |
| `aero_body` | Aero & Karosserie | part (Frontlippe · Splitter · Seitenschweller · Diffusor · Heckflügel/Spoiler · Widebody · Motorhaube · Folierung · Lackierung · Sonstiges), brand, material (Carbon · GFK · ABS · Sonstiges), colour |
| `interior` | Innenraum | part (Sitze · Lenkrad · Überrollkäfig · Gurte · Schaltknauf · Instrumente · Verkleidung · Sonstiges), brand, model |
| `electronics` | Elektronik & Licht | part (Beleuchtung · Audio · Anzeigen · Datenlogger · Codierung · Sonstiges), brand, model |
| `drivetrain` | Antrieb & Getriebe | part (Kupplung · Schwungrad · Sperrdifferenzial · Getriebe · Antriebswelle · Sonstiges), brand, model |
| `other` | Sonstiges | title (required) |

### 3.4 QR codes & stickers
- Every **published** vehicle gets one active QR. URL: `{APP_URL}/C/{CODE}` in **uppercase** (QR alphanumeric mode → fewer modules → better scans on small stickers). Routes accept `/c/` and `/C/`.
- Code: 8 chars Crockford base32 (no I, L, O, U), random, unique, unguessable. Rate-limit the resolver.
- Rendering: **always black on white**, quiet zone 4 modules, error correction Q, no logo inside the code; the sticker artwork places the logo **beside** the code.
- Downloads (QR-02): PNG (1024/2048 px), SVG, PDF (A6 sticker sheet with logo, @username, short code, placement hint). Server-rendered = identical everywhere.
- **Revoke & reissue** (QR-02 dialog): old code shows WEB-06 "Dieser QR-Code ist nicht mehr gültig" (no link to the vehicle, protects sold cars).
- **Placement guide** (QR-03) — legal, conservative wording (see `08_LEGAL_COMPLIANCE.md` §7).
- **Scan counting:** increment a per-day counter only; exclude the owner and known bots; no IP, no user id stored. Owners see counts in QR-02 when `sig.qr_stats` is on.

### 3.5 Social
- **Follow** a member (no approval). Remove follower possible (PROF-04). Follow counts visible only on profiles (real numbers, never inflated).
- **Save** a build ([SIGNATURE] `sig.saved_builds`): private bookmark list (PROF-05); owner sees an aggregated weekly notification ("3 Mitglieder haben deinen R34 gespeichert"), never who.
- **Share**: native share sheet / Web Share API with the canonical public URL; copy link; show QR.
- **Block** hides both profiles and vehicles from each other everywhere, ends conversations, prevents follows/messages. **Report** opens the report flow (reason → details → sent).

### 3.6 Messaging
- 1:1 conversations. "Wer darf dir schreiben": Alle (default) · Mitglieder, denen ich folge · Niemand.
- A message from someone the recipient does not follow lands in **Anfragen** (MSG-01 tab). Until accepted, the sender can send **one** message; the recipient's read state is not revealed (MSG-04). Accept → moves to Chats; Delete; Block & report.
- Types: text (≤ 2000 chars), one photo per message, vehicle card (shared from VEH-01 → "Fahrzeug senden").
- Starting from a vehicle adds a **vehicle-context card** at the top of the conversation.
- Delete for me; delete conversation (for me). Reported threads become visible to moderators **only** for the reported messages + context (ADM-22).
- [SIGNATURE] typing indicator, read receipts (each user can turn off "Lesebestätigungen senden"), 6 fixed reactions (👍 ❤️ 🔥 😂 😮 🏁 rendered as icons where possible), pin / mute / archive conversations, search in conversations.
- Realtime via Pusher Channels when configured; polling fallback (3 s in an open conversation, 15 s in the inbox, paused in background).

### 3.7 Discover & search
- **Vehicles:** free text (make, model, generation, nickname, description, mod brands/parts) + filters: make, model, generation, model year range, power range (PS, slider 50–1500 step 10 + numeric inputs), drivetrain, gearbox, fuel, wheel diameter, wheel brand, suspension type, suspension brand, exhaust brand, "has modification in category". Sort: Relevanz · Neueste · Zuletzt aktualisiert · Meiste PS.
- **Members:** username, display name, city; result rows show garage summary ("3 Fahrzeuge · BMW, Nissan").
- Facet counts on filter chips; "Filter zurücksetzen" on no results.
- **Make page / model collection** (DISC-03/04): builds of e.g. BMW M4 (G82) with generation chips and a **wheel-setup comparison table** view (diameter, width, ET, tyre size per build) — directly serves brief §5.
- Recent searches are stored on the device only.

### 3.8 Home
- Segmented **Für dich / Folge ich**.
- **Für dich** modules (varied rhythm, not a uniform grid): featured build (admin-curated editorial hero, 16:9) → "Neue Builds" (vehicle cards) → build-update rows → "Aktive Mitglieder" strip → "Beliebte Mods diese Woche" chips → continues with mixed vehicle cards / update rows.
- Ranking (rule-based, explainable): recency decay (half-life 72 h) × completeness (photos, specs, mods) × quality (cover photo resolution) + engagement (saves, new followers in 7 days) + admin boost; diversity rule: max 2 consecutive items from the same owner.
- **Folge ich**: chronological builds and updates from followed members; empty state suggests members with similar cars.

### 3.9 Units & formatting (German first)
- Numbers `de-DE`: "1.500", "2,9 l". Power default "510 PS (375 kW)"; torque "650 Nm"; wheels `19″ × 9,5J ET35`; tyres `255/35 R19`; lowering "−35 mm"; displacement "2.568 cm³" + short "2,6 l".
- Dates: "März 2023", "vor 3 Std.", "gestern", "14.06.2026". Time zone Europe/Berlin.
- Settings → Sprache & Einheiten (SET-11): Deutsch/English; power display PS (kW) · kW (PS) · hp; metric only.

## 4. Flows (acceptance criteria — every flow is an automated E2E test)

**F1 Onboarding.** Welcome → Konto erstellen → Verify code → Username → Profile setup → Notification primer (native) → Garage empty state "Füge dein erstes Auto hinzu". Edge: email already used → offer Anmelden / Passwort vergessen; code expired → resend; app killed mid-flow → resumes at the next incomplete step.

**F2 Add first vehicle → QR.** Garage "+" → Step 1 Fahrzeug (make → model → generation → year; "Nicht gefunden?") → Step 2 Technik (PS/kW toggle, provenance) → Step 3 Fotos & Beschreibung (≥ 1 photo, cover, ≤ 500 chars) → Step 4 Prüfen & veröffentlichen (visibility) → GAR-04 success with QR reveal → "Mods hinzufügen". Every step autosaves; leaving shows the discard guard; upload failures stay in the queue with retry.

**F3 Modifications.** Vehicle → Mods → Hinzufügen → category → category form → Speichern → build update created (hideable). Edit/remove keeps history.

**F4 Stranger scans QR (no app).** Camera opens `/C/7H2KQXMB` → server resolves → revoked/private/not found → WEB-06 state → otherwise 302 to canonical `/v/{slug}` → server-rendered page (LCP < 2.5 s on 4G) with photos, specs, mods, owner → sticky bar "In der App öffnen" (universal/app link if installed, store link otherwise) + "Registrieren" (web sign-up keeps `next=/v/{slug}` and returns there). Scan counted without IP/PII.

**F5 Discover → follow/message.** Discover → "M4" → filters (G82, 19″) → result → vehicle → owner → Folgen / Nachricht. Message to a non-follower lands in their Anfragen.

**F6 Messaging safety.** Request → preview without read receipt → Annehmen / Löschen / Blockieren & melden. Block hides both ways and ends the conversation. Report creates an admin case.

**F7 Profile & settings.** Profil → Einstellungen → privacy (who can message), appearance (Carbon/Schwarz/Hell/System — instant, no flash), language & units, security (2FA, sessions).

**F8 Account deletion.** In-app (SET-13) and web (`/konto-loeschen`, WEB-05) paths; re-auth; immediate deactivation; hard delete ≤ 30 days; confirmation email.

**A1 Restrict user.** User record → Einschränken (messaging off / publishing off / full suspension; duration; reason; statement-of-reasons template) → password re-confirm → audit + email to member with redress info.

**A2 Report handling.** Queue → case → evidence → decision (no action / remove content / restrict / suspend) → SoR from template + editable facts → notify reporter and affected member → appeal window → Einsprüche tab.

**A3 Branding publish/rollback.** Marke & Theme → upload hero → preview mobile + web × 3 themes → Publish (reason) → clients pick it up ≤ 5 min (ETag) → Version history → Rollback (one click, audited).

**A4 Role assignment.** Team → change role → diff of permission atoms → elevation to Admin/Owner creates an approval request → second admin approves → audit.

## 5. Signature features — [SIGNATURE], behind flags, default ON in staging
| Flag | Feature | Where |
|---|---|---|
| `sig.saved_builds` | Save builds + "Gespeichert" list + weekly aggregated owner notification | VEH-01, PROF-05 |
| `sig.compare` | Compare two builds side by side (specs + mods per category) | VEH-06 |
| `sig.share_cards` | Server-rendered share cards 9:16 + 1:1 PNG (photo, make/model, 3 specs, @username, QR) for Instagram/WhatsApp stories | VEH-07 |
| `sig.placard_pdf` | Car-show placard / build sheet A5 + A4 PDF with QR and spec table | QR-02 download sheet |
| `sig.qr_stats` | Daily scan counts (no identities) + milestones | QR-02 |
| `sig.mod_legal_status` | ABE / Teilegutachten / Eingetragen … field with disclaimer | GAR-10, VEH-02 |
| `sig.plate_blur` | Manual plate/face blur tool on photos (server applies pixelation; original discarded) | GAR-08 |
| `sig.hu_au_reminder` | HU/AU due month on vehicle + reminder 30 days before (push/email) | GAR-06, SET-09 |
| `sig.msg_typing` / `sig.msg_read_receipts` / `sig.msg_reactions` | Messaging pro | MSG-02 |
| `sig.msg_organize` | Pin / mute / archive / search conversations | MSG-01, MSG-05 |
| `sig.similar_builds` | "Ähnliche Builds" (same model/generation, similar mods) on vehicle page; "Mitglieder mit ähnlichen Autos" on Discover | VEH-01, DISC-01 |
| `sig.web_shortcuts` | Web desktop: `/` focuses search, `⌘K/Ctrl K` quick switcher, `g h/d/g/m/p` jumps to tabs, `?` shortcut sheet | Web shell |

## 6. AI features — [AI], Phase 3, behind flags, opt-in, labelled "KI-Vorschlag" (EU AI Act Art. 50)
Implemented with the **Laravel AI SDK** (`laravel/ai`), provider-agnostic (default: Anthropic `claude-haiku-5-5`; switchable in config), **fakes in tests/dev**, every call logged (feature, latency, tokens, outcome — no personal content in logs). The user always confirms; nothing is auto-published.
| Flag | Feature |
|---|---|
| `ai.nl_search` | Natural-language search → the same **visible filter chips** ("schwarze M4 mit KW V3 und 19 Zoll" → make BMW, model M4, colour black, suspension brand KW, wheel 19″). User can edit/remove chips |
| `ai.mod_assist` | Paste text (e.g. a shop invoice line) → suggested category, brand, model, sizes; each field confirmed by the user |
| `ai.photo_tagging` | Suggest photo category (exterior/interior/engine/wheels/detail) on upload |
| `ai.translate` | On-demand DE↔EN translation of descriptions/messages, labelled "Übersetzt" |
| `ai.description_assist` | "Beschreibung vorschlagen" from structured data only — no invented numbers; user edits |
| `ai.moderation_triage` | Admin: risk score + reason summary on reports/media; **a human decides**; SoR states whether automation was used (DSA Art. 17) |
**Never:** chatbots for their own sake, predicted horsepower gains, legality judgements, AI-generated car photos.

## 7. Notification matrix
| Event | In-app list | Push (default) | Email |
|---|---|---|---|
| New follower | ✓ | ✓ on | — |
| Message request | badge "Anfragen" | ✓ on | — |
| New message | tab badge (not in list) | ✓ on | optional daily digest if unread > 12 h (default off) |
| Followed member published a vehicle / build update | ✓ grouped | off (opt-in) | — |
| Build saved ([SIGNATURE]) | ✓ weekly aggregate | off | — |
| QR scan milestone ([SIGNATURE]) | ✓ | off | — |
| Moderation decision / appeal result | ✓ | ✓ on | ✓ mandatory (statement of reasons) |
| Security: new device, password/email/2FA changed, deletion requested | ✓ | — | ✓ mandatory |
| HU/AU reminder ([SIGNATURE]) | ✓ | ✓ on | ✓ if enabled |
| Admin announcement | banner, not a notification | — | — |
Per-type toggles in SET-09; quiet hours 22:00–07:00 default on for non-urgent push.

## 8. Rate limits & abuse controls (server-enforced; friendly German errors)
Registration 5/h/IP · login 10/min/IP + progressive delay after 5 failures per account (no hard lockout) · verification code 5 attempts/code · new conversations 20/day (requests 10/day) · messages 30/min · follows 200/day · uploads 60/h · reports 20/day · search 60/min · QR resolver 120/min/IP · public API reads (catalogue, app config, legal) 300/min/IP. Optional Cloudflare Turnstile on web sign-up/report when keys are configured.

## 9. Content & community rules (summary; full text is a CMS legal document)
No organising or glorifying illegal street racing (§315d StGB) — "underground" is an aesthetic only. No harassment, hate, nudity, doxxing, spam or stolen photos. Number plates are the owner's choice (blur tool offered). Modifications are owner-declared; SPEED CLUB never states legality.

## 10. Copy, tone & glossary
German **du**, concise, technical, calm. No emojis in UI chrome, no exclamation-mark spam, no marketing fluff inside workflows. Never uppercase long German words. English is the second locale.
| Concept | DE (UI) | EN |
|---|---|---|
| Tabs | Start · Entdecken · Garage · Nachrichten · Profil | Home · Discover · Garage · Messages · Profile |
| Main vehicle | Hauptfahrzeug | Main vehicle |
| Modifications | Mods (tab) / Modifikation (singular action) | Mods / Modification |
| Build history | Verlauf | History |
| Specs | Technik | Specs |
| Overview | Übersicht | Overview |
| Add vehicle | Fahrzeug hinzufügen | Add vehicle |
| Publish | Veröffentlichen | Publish |
| Save draft | Entwurf speichern | Save draft |
| Requests | Anfragen | Requests |
| Follow / Following | Folgen / Folge ich | Follow / Following |
| Followers | Follower | Followers |
| Saved | Gespeichert | Saved |
| Factory / Owner claim / Measured | Werksangabe / Besitzerangabe / Gemessen | Factory / Owner claim / Measured |
| Installed / Planned / Removed | Verbaut / Geplant / Entfernt | Installed / Planned / Removed |
| Report / Block | Melden / Blockieren | Report / Block |
| Two-factor (TOTP + recovery codes), the feature's name everywhere: settings row, mails, errors, help, privacy | Zwei-Faktor-Schutz (der; not "Zwei-Faktor-Anmeldung") | Two-factor protection (not "two-factor sign-in/authentication") |
| Account (brand compound, house style: no hyphen) | SPEED CLUB Konto | SPEED CLUB account |
| Appearance themes | Carbon · Schwarz (OLED) · Hell · System | Carbon · Black (OLED) · Light · System |
| Offline banner | "Offline – Änderungen werden gesendet, sobald du online bist." | "Offline – changes will be sent when you're back online." |
| Retry | Erneut versuchen | Try again |
Error messages: say what happened + what to do ("Das Foto ist größer als 15 MB. Wähle ein kleineres Foto."). Never blame the user, never show codes without text.
