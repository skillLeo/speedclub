# 03 — Design System & Flagship Screen Blueprints

> **Superseded by `docs/09_PREMIUM_2_0.md` §4–§7 where they conflict** (Phase 4, SPEED CLUB 2.0, ADR-401): fonts (Archivo + Inter 4, ADR-402), radii (0/4/8/12/20/full, ADR-403), motion (spring/effect tokens, ADR-405), navigation (native tabs, ADR-404), components and screen blueprints. Where 09 is silent, this document still applies.

**Source of truth for values:** `design/tokens/tokens.json` → generated files (`node design/scripts/build-tokens.mjs`).
**This document** explains how to use them and defines the exact layout of the flagship screens.
**No value may appear in code that is not a token** (lint + runtime DOM audit enforce this).

---

## 1. What "agency-grade, not AI-generated" means here (operational definition)
Premium products (Linear, Stripe, Porsche/BMW apps, Apple apps) look expensive because of **fewer, better decisions applied with total consistency** — not decoration:
- one UI family + one display family with a strict scale; one icon family; a 4-pt grid with **no exceptions**; four radii; hairlines instead of boxes;
- real content (real German copy, real car data, real photography) — never lorem ipsum or fake counts;
- clear hierarchy through size, weight and colour — not through more cards, borders, gradients or shadows;
- every state designed (loading, empty, error, offline, restricted, long text, 200 % font);
- motion that explains spatial relationships, never motion for its own sake.

**Design principles:** (1) The car is the hero. (2) Precision over decoration. (3) Brand at the edges. (4) Night-ready. (5) One thumb.

## 2. Brand layer vs product layer
| Brand layer — allowed | Product layer — never brush/grunge |
|---|---|
| Native splash, Welcome (AUTH-02), web landing (WEB-03), empty garage, publish-success (GAR-04), QR sticker artwork, featured-build editorial header, share cards, OG images | Forms, spec tables, navigation, settings, messages, filters, admin |
| Brush wordmark (client PNG/SVG, never redrawn), katakana スピードクラブ between hairline rules, grain overlay ≤ 4 % opacity, one red slash/rule accent | Inter + Barlow Semi Condensed, hairlines, solid surfaces |
The logo is **never** recreated in a font, distorted, outlined, recoloured (except pure white / pure black versions) or placed on busy areas without a scrim.

## 3. Colour
Themes: **Carbon** (default dark) · **Schwarz/Black (OLED)** · **Hell/Light** · **System** (dark → Carbon, light → Hell). Values in `tokens.json`; all text pairs pass WCAG AA on canvas, surface, raised **and** overlay (gate enforced).

| Role | Carbon | Black | Light | Use |
|---|---|---|---|---|
| bg.canvas | #0B0B0C | #000000 | #F6F6F4 | app background |
| bg.surface | #141416 | #0E0E10 | #FFFFFF | cards, bars, list groups |
| bg.raised | #1C1C1F | #17171A | #EFEFEC | inputs, sheets, segmented track |
| bg.overlay | #242428 | #202024 | #FFFFFF | menus, popovers, selected segment |
| text.primary | #F5F5F3 | #EDEDED | #111113 | titles, body, values |
| text.secondary | #A1A1A6 | #A1A1A6 | #4E4E53 | labels, metadata |
| text.tertiary | #8B8B91 | #8B8B91 | #646469 | timestamps, hints |
| border.subtle / default / control | #26262A / #33333A / #737379 | #1F1F23 / #2C2C31 / #737379 | #E4E4E0 / #D4D4CF / #7C7C82 | dividers / card outlines / input outlines (≥ 3:1) |
| accent.fg | #EC5A5F | #EC5A5F | #C8102E | tab indicator, unread, destructive text, badge outline |
| accent.fill | #C8102E | #C8102E | #C8102E | filled brand CTA (white label 5.9:1) |
| status success / warning / info | #3FB27F / #E0A43A / #8AB4F8 | same | #1A7347 / #8F5A00 / #1F5FBF | status text & icons |

**Rules**
- **Red ≤ 5 % of any screen.** Allowed: active tab indicator, unread dot/badge, destructive actions, the single brand CTA on brand moments, Hauptfahrzeug badge outline, content-tab underline. Never body text, large fills, gradients, or decoration.
- **Default primary button = inverse** (bg.inverse with text.inverse: light button on dark themes, dark button on light). Red filled buttons only on brand moments (Welcome, publish success, public page "In der App öffnen").
- Dark themes express elevation with **surface steps** (canvas → surface → raised → overlay), never shadows. Light uses `shadow.e1/e2/sheet`.
- Black theme: scrolling content sits on `bg.surface` cards, not raw #000, to limit OLED smear; text.primary is #EDEDED (not #FFF) to limit halation.
- **Photos:** text on photos uses `onPhoto.*` over a bottom scrim (0 → rgba(0,0,0,.72) across the bottom 45 %) — guarantees ≥ 4.5:1 on any photo.
- **QR is always black on white** (`qr.*`) in every theme, on a white quiet-zone card.
- **`media.ground`** (#000 in every theme) is the ground under full-screen photography: the image viewer and the Welcome photo fading in. Never a page or card background (DQ-104).
- **Admin accent switch** (ADM-28) may only choose a set from `accentPalette` (Signal Red default, Ember Orange, Racing Blue, Pit Green — each pre-validated). No free hex entry.

## 4. Typography
- **UI: Inter** (OFL) static instances 400/500/600/700. **Display & hero numerals: Barlow Semi Condensed** (OFL) 500/600/700 — a narrow grotesk with road-sign/licence-plate heritage that carries the motorsport/JDM feel without brush lettering. Self-hosted everywhere (GDPR: no Google Fonts CDN).
- Native: load with `@expo-google-fonts/*`, hide the splash only after fonts + theme are ready (no font flash). Use the **family name per weight** (e.g. `Inter_600SemiBold`); never set `fontWeight` together with a custom family (Android picks the wrong face).
- Web (Blade/admin): `@fontsource/inter` + `@fontsource/barlow-semi-condensed`, `font-display: swap`, preload the two most used weights.

| Style | Font | Size/Line | Weight | Tracking | Use |
|---|---|---|---|---|---|
| display.xl | Barlow SC | 40/44 | 700 | −0.4 | brand moments, landing hero |
| display.l | Barlow SC | 32/36 | 700 | −0.3 | vehicle model name on VEH-01, success screens |
| display.m | Barlow SC | 24/28 | 600 | −0.2 | featured build title, KPI numbers (admin) |
| title.l | Inter | 28/34 | 700 | −0.4 | large titles on tab roots |
| title.m | Inter | 22/28 | 600 | −0.2 | profile name, sheet titles |
| title.s | Inter | 18/24 | 600 | −0.1 | section headers, card titles |
| headline | Inter | 17/22 | 600 | −0.1 | compact header title |
| body / body.strong | Inter | 16/24 | 400 / 600 | 0 | default text |
| body.dense | Inter | 15/22 | 400 | 0 | chat bubbles, dense lists |
| label / label.s | Inter | 16/20 · 14/20 | 600 | 0 | buttons, inputs / small buttons, tabs in content |
| supporting | Inter | 14/20 | 400 | 0 | sub-lines, metadata |
| helper | Inter | 13/18 | 400 | 0 | input helper/error |
| caption | Inter | 12/16 | 500 | +0.1 | timestamps only |
| eyebrow | Inter | 12/16 | 600 caps | +0.8 | max 2 short words ("NISSAN", "FEATURED BUILD") |
| tab / badge | Inter | 11/13 | 600 | 0 | tab labels, badges (max font scale 1.3) |
| spec.strip | Barlow SC | 22/26 | 600 tnum | 0 | hero spec numbers (500 · 540 · 2002) |
| spec.value | Inter | 16/22 | 600 tnum | 0 | values in spec tables (right-aligned) |
| spec.unit | Inter | 13/16 | 500 | 0 | units in text.secondary |
| code | Inter | 15/20 | 600 tnum caps | +1.5 | QR short code "7H2K QXMB" |

**Rules:** body is 16 (not 15) — German compounds need room; nothing informational below 12. Respect OS font scaling (body/titles scale fully; tab label and badges capped at 1.3 with long-press large-content label). Layouts wrap, never truncate key data (make/model, power, prices). German hyphenation: web `hyphens: auto` with `lang="de"`; Android `textBreakStrategy="balanced"` + `android_hyphenationFrequency="normal"`. **Never uppercase long German words** (eyebrow only). Android: `includeFontPadding: false` + explicit `lineHeight` on every Text (built into the `Text` primitive).

## 5. Layout, spacing, shape
- **Spacing scale (only these values):** 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Gutters:** 16 on widths < 390, 20 on ≥ 390 (phone), 24 on tablet/desktop. Card padding 16. Section gap 32. Section header → content 12. Card → card 24 (lists), 16 (dense lists).
- **Rows:** single-line 56, with 56-thumb 72. Spec rows ≥ 48.
- **Radii:** 4 (badges/tags/status pills) · 8 (buttons, inputs, small tiles) · 10 (search field only) · 12 (cards, image tiles, dialogs) · 16 (sheet top corners, QR card) · full (avatars, chips, switch, composer). **Nothing above 16.** Oversized rounding is a template tell.
- **Borders:** dividers = hairline (`StyleSheet.hairlineWidth` native / 1 px `border.subtle` web); control borders 1; input focus 1.5 `text.primary`; focus ring (web/keyboard) 2 px + 2 px offset `focus.ring`.
- **Safe areas:** every screen uses the `Screen` primitive (insets via `react-native-safe-area-context` on native, CSS `env(safe-area-inset-*)` on web — SDK 58 no longer provides insets on web through the context).
- **Web shell & grids:** < 768 = phone layout identical to the app (bottom tab bar, 4-col grid). 768–1279 = 72-px **rail** (icon + label) + 8-col grid. ≥ 1280 = 240-px **sidebar** (logo, 5 destinations, "Fahrzeug hinzufügen" button, account menu) + 12-col grid, content max 1200. Feed column 640 + right rail (Discover shortcuts, your garage). Inbox split 360 + thread. Settings split 280 + detail. Vehicle desktop: gallery 7/12 + sticky spec/owner card 5/12.

## 6. Iconography
- **Phosphor** only (`phosphor-react-native`, `@phosphor-icons/vue`, raw SVG from `@phosphor-icons/core` for Blade). Weights: **regular** for UI, **fill** for the active tab and selected states. Sizes 16 / 20 / 24 only. Icon colour = the text colour it accompanies.
- **Custom automotive set (16 glyphs)** drawn on Phosphor's 256 grid, 16-unit stroke, round caps/joins, matching optical size: wheel, tyre, coilover, air-suspension, exhaust, turbo, intake, engine, ecu-chip, brake-disc, wing, seat, light, audio, gearbox, drivetrain. Ship as SVG sources in `design/icons/auto/*.svg` → generated RN components (`mobile/src/ui/icons/auto/`), Vue components and a Blade sprite. Categories map: Räder & Reifen=wheel, Fahrwerk=coilover, Abgasanlage=exhaust, Motor & Leistung=turbo, Bremsen=brake-disc, Aero & Karosserie=wing, Innenraum=seat, Elektronik & Licht=light, Antrieb & Getriebe=gearbox, Sonstiges=Phosphor `wrench`.
- **No emoji as icons.** No sparkle ✨ for AI — use the label "KI-Vorschlag" + Phosphor `magic-wand` at 16.
- **Make tiles have no manufacturer logos** (trademark) — text tiles only.

## 7. Photography & media
- Ratios: vehicle hero and cards **4:3**; editorial/featured **16:9**; avatars 1:1; share cards 9:16 and 1:1; covers 3:1. Never 1:1 for car cards (avoids Instagram look).
- Respect the **focal point** set in GAR-08 for every crop (`contentPosition` in expo-image / `object-position` on web). Never centre-crop a car's nose off.
- Placeholder: **blurhash** from the API + explicit aspect ratio → zero layout shift. Fade-in 200 ms.
- Night shots: no auto-brightening, no filters. Image viewer background always pure black.
- Plates/faces: reminder in the upload flow ("Achte auf Kennzeichen und Personen"), blur tool [SIGNATURE].
- Demo/seed photos: real, licensed photography in `design/seed-photos/` with `CREDITS.md` (Unsplash/Pexels licence or client-owned). Never AI-generated car photos.

## 8. Components (all sizes pt = px; every component has default, pressed, focused, disabled, loading, error states)
| Component | Spec |
|---|---|
| **Bottom tab bar** | 64 content + bottom safe inset; 5 equal items; icon 24 + 4 gap + label `tab`; active = fill icon + text.primary + red indicator bar 16×2 placed 6 above the icon; inactive = regular icon + text.secondary; top hairline border.subtle; background `tabBar.background` + blur on iOS/web, solid on Android. Badge on Nachrichten (count pill, "99+"), dot on Start for unread notifications |
| **Header** | Large title (title.l) on tab roots, collapses to compact 44 + status bar with `headline` centred after 52 pt of scroll; hairline appears when content scrolls under; actions are 44×44 icon buttons; back = chevron + previous title (iOS) / chevron only on narrow widths |
| **Segmented control** | height 36, radius 8, track bg.raised, selected pill bg.overlay (light: surface + e1), label `label.s`; max 3 segments; selection haptic |
| **Content tabs** (vehicle) | height 44, label 15/20 600, active 2-pt accent.fg underline that slides (140 ms), scrollable when overflowing, sticky under the compact header |
| **Button L / M / S** | 52 / 44 / 36 high; radius 8; padding-x 20 / 16 / 12; label `label` (S uses `label.s`); S only inline with hitSlop to 44. Variants: **Primary** (inverse), **Brand** (accent.fill, white label — brand moments only), **Secondary** (bg.raised + 1 border.default), **Tertiary** (text only), **Destructive** (accent.fg text; filled red only in the final confirm). Loading = spinner replaces label, width locked; disabled = text.disabled on bg.raised |
| **Icon button** | 44×44 target, 24 glyph, pressed bg `state.pressed`, on photos: 36 visual circle `onPhoto.chipBg` inside 44 target |
| **Text input** | 52 high, radius 8, bg.raised, 1 border.control, label above (`label.s` 14/20 text.secondary), helper/error below (`helper`); focus border text.primary 1.5; error border accent.fg + icon + text (never colour only); suffix units in text.secondary ("cm³", "Nm", "″", "mm") |
| **Search bar** | 44 high, radius 10, bg.raised, leading 20 icon, clear button, "Abbrechen" text action when focused |
| **Chip (filter/choice)** | 36 high, radius full, 1 border.default, label `label.s`; selected = bg.inverse + text.inverse; removable chips have a 16 × icon with 44 hit area; count badge inside |
| **Spec chip (static)** | 24 high, radius 4, bg.raised, `caption` 600 tnum — e.g. "500 PS" "540 Nm" "AWD" |
| **Status pill** | 20 high, radius 4, 1 border.default, `badge` text.secondary — "Verbaut", "Geplant"; legal status uses the same shape |
| **Switch** | 51×31 track (same metrics everywhere); on = text.primary track + canvas thumb (no green); spring.snappy; selection haptic |
| **Checkbox / radio** | 22 visual, 44 target, radius 4 / full, 1 border.control; checked = bg.inverse + text.inverse glyph |
| **Range slider (PS)** | track 4, thumbs 28, tnum value bubbles above, step 10, 50–1500, plus two numeric inputs |
| **Stepper** | 36 high, − / + as 44 targets |
| **Vehicle card** | full width; 4:3 image radius 12; 12 below: title `title.s` ("Nissan Skyline GT-R R34"), sub-line `supporting` text.secondary ("2002 · 2,6 l R6 Biturbo"), 8 below: spec chips (PS, Nm, drivetrain); optional owner row (avatar 32 + @username `supporting` + time `caption` tertiary); "Hauptfahrzeug" badge top-left on the image (12 inset; 1 accent.fg outline, `badge` text on onPhoto.chipBg) |
| **Grid tile** (results grid) | 2 columns, gap 12; 4:3 image radius 8; title `label.s` 2 lines max; 1 spec line `caption` |
| **Build-update row** | 56 thumb radius 8; title `body.strong` ("Fahrwerk geändert"); diff `supporting` tnum ("Serie → KW V3 · −35 mm"); meta `caption` tertiary ("@jann.ptrs · vor 2 Std."); hairline inset to text start |
| **Member row** | avatar 40; name `body.strong`; @username + city `supporting` secondary; trailing Follow button M |
| **Mod row** | category glyph 20 text.secondary; name `body.strong`; key values `supporting` tnum; trailing status pill; chevron |
| **Spec row** | ≥ 48 high; label left `supporting` text.secondary; value right `spec.value` (+ `spec.unit`); provenance as `caption` tertiary under the value when not factory; hairline between rows |
| **List row** | 56 (single) / 72 (with subtitle); leading icon 20 text.secondary; title `body`; trailing value `supporting` secondary + chevron 16 tertiary |
| **Avatar** | 24/32/40/56/96; 1 inner border `avatar.innerBorder`; fallback = initials on bg.raised, `label` text.secondary |
| **Bottom sheet** | top radius 16, grabber 36×4 (border.strong) 8 from top, max 90 % height, snap points content / 90 %, scrim token, spring.sheet, light haptic on snap to full; title `title.m`; keyboard-aware; Escape/scrim closes on web |
| **Dialog** | max width 320, radius 12, bg.overlay, title `title.s`, body `body.dense`, buttons stacked on narrow widths; destructive action last; focus trapped on web |
| **Toast** | bottom, 8 above tab bar, min 48, radius 8, bg.inverse + text.inverse, 4 s, includes "Rückgängig" where possible; announced to screen readers |
| **Skeleton** | bg.raised blocks matching final geometry exactly; shimmer 1.2 s (off in reduced motion); show only after 300 ms; never longer than the content it replaces |
| **Empty state** | one icon (glyph 48) or brand illustration ≤ 120; title `title.s`; one line `body.dense` secondary; one button |
| **Error state** | plain-language cause + "Erneut versuchen"; never raw codes |
| **Offline banner** | top, 32 high, bg.raised, `supporting`: "Offline – Änderungen werden gesendet, sobald du online bist." |
| **Image viewer** | pure black; pinch 1–4×, double-tap 2×, drag-to-dismiss (threshold 120 or velocity 800), counter "3/12" |
| **QR display** | white card radius 16 padding 24; QR ≥ 200 (fills card width − 48, max 320), quiet zone 4 modules, EC level Q; short code `code` style in black below; URL `caption` in qr.caption |
| **Chat bubble** | max width 75 %, radius 16 with 4 on the tail corner; own = bg.inverse + text.inverse; other = bg.raised + text.primary; `body.dense`; group within 5 min; time `caption` tertiary under the group |
| **Composer** | min 44, grows to 5 lines, radius full, bg.raised; attach 44; send 44 circle bg.inverse (disabled until text) |
| **Unread badge** | dot 8 or pill 18 high, accent.fill + white `badge` |
| **Progress (upload/wizard)** | 2 high; wizard = 4 segments with 4 gap; upload = per-photo ring 20 on the tile |

**Global per-screen state contract:** every data route ships **Loading** (skeleton), **Empty/first-run**, **Error** (+ retry), **Offline** (cached + banner), **Restricted** (account limited), and for forms: inline validation, submitting, success toast, server error, discard-changes guard. Plus long-text and 200 % font variants.

## 9. Navigation & one-handed ergonomics
- **Five tabs exactly as the brief:** Start · Entdecken · Garage · Nachrichten · Profil. **No centre "+" FAB.** "Fahrzeug hinzufügen" lives in the Garage header (+), in the empty state and as a row on the profile.
- **Custom tab bar on Expo Router headless tabs (`expo-router/ui`)**, identical on iOS, Android and web (native tabs fall back to a basic implementation on web — parity would break). Trade-off accepted: no automatic iOS Liquid Glass.
- Re-tap active tab → scroll to top, then pop to root. Each tab keeps its own stack + scroll position. Labels always visible. No hide-on-scroll. Test "Nachrichten" at 320 pt width (fallback label "Chats" only with client approval).
- Tab bar stays visible on pushed screens inside tabs; hidden in modal stacks (wizard, editors, viewer, auth).
- **Placement rules:** lists/feeds — search + filter chips under the title, primary action header-right with a duplicate in the empty state; forms/wizards — **sticky bottom CTA bar** (52 button + 12/16 padding + safe inset) riding above the keyboard, Back/Close top-left, "Entwurf speichern" tertiary bottom-left; destructive — never adjacent to primary, always behind a sheet/dialog with explicit wording ("Fahrzeug löschen"); pickers and actions — bottom sheets, not top menus.
- **Back:** iOS edge swipe on every pushed screen; Android predictive back through `targetSdk` 36 (see ADR-117); dirty forms intercept back with the discard guard.

## 10. Motion & haptics (tokens in `motion`)
Reanimated 4 (UI thread) + Gesture Handler 3. Animate **transform and opacity only**. Exits ~20 % faster than entrances. Overshoot ≤ 2 %. Nothing loops except skeleton shimmer.
| Interaction | Motion | Haptic |
|---|---|---|
| Press (cards, buttons) | scale 0.98 + opacity 0.92, spring.snappy | — |
| Tab switch | instant content swap + 140 ms indicator slide | — |
| Push / pop | native stack (iOS slide, Android predictive back); web 260 ms fade+translate 12 | — |
| Sheet open/close | spring.sheet, scrim fade 200 | light on snap to full |
| Card → vehicle hero | shared-element image where supported, else 200 ms crossfade | — |
| Follow / Save | icon swap 140 + label change; no confetti | light |
| Message send | bubble rises 8 + fade 200 | — |
| Skeleton → content | crossfade 200, no stagger | — |
| Toast | slide 12 + fade 200 | success/warning where meaningful |
| Publish → QR (GAR-04) | QR modules "print" with a single 600 ms mask wipe, then a 1-px accent rule draws under the wordmark | success |
| Segmented / switch / chip | spring.snappy | selection |
| Destructive confirm | — | warning |
| Splash | static native splash, 200 ms fade into the first screen | — |
**Reduced motion:** slides and shared elements become 120 ms crossfades; shimmer and parallax off. **Avoid:** staggered list entrances, parallax > 10 %, looping gradients, bouncing badges, animated counters. Budget: 16.7 ms/frame at 60 Hz, 8.3 ms at 120 Hz; never animate layout of long lists.

## 11. Themes — behaviour
- Preference stored on device (AsyncStorage) and in the account (`users.theme`); read **before the splash hides** → no white flash. Native splash background #0B0B0C.
- Web: inline `<script>` in `<head>` sets `data-theme` before paint; `<meta name="color-scheme">` matches; Blade pages default to `system`.
- Status bar / Android navigation bar icons light on dark themes, dark on light.
- Switching theme in SET-10 crossfades 200 ms (no flash, no re-mount).

## 12. Web parity rules ("100 % same interface")
- The member web **is the same Expo Router codebase** exported to static files and served by Laravel at `/app`. On phone widths it must be pixel-identical to the native app (verified by screenshots).
- Allowed differences (tell the client): OS permission dialogs, native share sheet (web: Web Share API or custom sheet), date/photo pickers (web: file input + drag-and-drop), push (web: email + in-app badges), camera, haptics, predictive back / edge swipe, minor font rasterisation differences.
- Tablet/desktop layouts (rail/sidebar, split views, 2-pane wizard) are additions of the same components, never different designs.
- Public pages (`/v`, `/c`, `/u`, landing, legal) are **Blade SSR** for speed + SEO but must match VEH-01/PROF-02 visually (same tokens CSS, same structure). A Playwright parity test diffs `/v/{slug}` vs `/app/v/{slug}` at 390 px.

## 13. Flagship screen blueprints (build these first; they set the bar for all others)
Measurements use tokens; G = gutter (16/20). All copy is real German.

**FS-1 Welcome (AUTH-02, brand moment).** Full-bleed night photo (admin-configurable, focal point) with bottom scrim over 55 %. Logo (client file) centred, width min(72 %, 320), top at 28 % of height. Bottom block, G side padding, bottom = safe inset + 16: `display.l` uppercase "CARS. PEOPLE. CULTURE." → 8 → `body` onPhoto.secondary "Deine Garage, deine Mods, dein QR-Code – vom Parkplatz direkt zum Build." → 24 → **Brand** button L "Konto erstellen" → 12 → outlined button L (1 onPhoto.border, white label) "Anmelden" → 8 → tertiary 44 "Erst umsehen". Motion: photo fades in 340 ms with one-time scale 1.04 → 1.0; logo fades 200 ms (delay 120); block rises 12 + fades 260 ms (delay 200).

**FS-2 Home (HOME-01).** Large title "Start", trailing bell (dot when unread). 8 → segmented "Für dich · Folge ich" (full width − 2G) → 16 → **Featured build**: edge-to-edge 16:9 photo (no gutters — breaks the grid on purpose), overlay bottom-left: eyebrow "FEATURED BUILD", `display.m` "Nissan Skyline GT-R R34", `supporting` "@lukas.sc · Stuttgart" → 32 → section "Neue Builds" (`title.s` + trailing "Alle") → 12 → 2 vehicle cards (24 apart) → 32 → "Build-Updates" + 3 update rows → 32 → "Aktive Mitglieder" horizontal strip (avatar 56, @username `caption`, car `caption` tertiary; 4.5 items visible to signal scroll) → 32 → "Beliebte Mods diese Woche" chips (max 2 lines) → mixed stream (cards / update rows alternating). Pull-to-refresh. Guest: same, Follow/Save trigger the auth sheet.

**FS-3 Vehicle profile (VEH-01) — the most important screen.** Edge-to-edge 4:3 hero pager (counter pill bottom-right "1/12"); overlay icon buttons (back left; share + more right) on onPhoto.chipBg circles; status bar light. 20 → eyebrow make "NISSAN" → 4 → `display.l` "Skyline GT-R R34" (case as stored) → 4 → `supporting` secondary "2002 · 2,6 l R6 Biturbo (RB26DETT) · Bayside Blue" → 16 → **spec strip**: bg.surface radius 12, 4 equal columns separated by hairlines, 16 vertical padding, values `spec.strip` ("500", "540", "2002", "AWD"), units/labels `caption` tertiary under each ("PS", "Nm", "Baujahr", "Antrieb") → 16 → **owner row**: avatar 40, name `body.strong`, "@lukas.sc · Stuttgart" `supporting`, trailing "Folgen" (secondary M) + "Nachricht" (primary M) → 24 → **content tabs** "Übersicht · Technik · Mods · Verlauf" (sticky). Übersicht: description (6 lines + "Mehr anzeigen"), "Highlights" (3 mod rows: wheels, suspension, exhaust) + "Alle Mods (14)", photo preview 2×2 + "Alle Fotos (12)", [SIG] "Ähnliche Builds" strip, closing owner card with "Nachricht senden". Technik: grouped spec tables (Fahrzeug, Motor, Leistung, Antrieb). Mods: groups by category (glyph + `title.s` + count) with mod rows. Verlauf: timeline by month with diff rows. States: skeleton mirrors hero/strip/rows; "Fahrzeug nicht verfügbar".

**FS-4 Garage (GAR-01).** Large title "Garage", header "+" (44). Main vehicle card first (badge "Hauptfahrzeug"), others below (24 apart), each with a trailing QR icon button and an owner-only completeness line ("Build zu 70 % vollständig" + 2-px bar). Section "Entwürfe": rows with thumb + "Entwurf · Schritt 2 von 4" + "Fortsetzen". Header text action "Sortieren" enables long-press drag. Empty: brand empty state — glyph wheel 48 inside katakana hairline frame, `title.s` "Füge dein erstes Auto hinzu", `body.dense` secondary "Dokumentiere Technik und Mods und erhalte deinen persönlichen QR-Code.", Primary L "Fahrzeug hinzufügen".

**FS-5 Add vehicle — Step 2 Technik (GAR-03).** Modal: close (×) left, `headline` "Fahrzeug hinzufügen". Under header: `caption` "Schritt 2 von 4 · Technik" + 4-segment progress. Groups (eyebrow headers, 24 between groups, 16 between fields): MOTOR — Motorcode (placeholder "z. B. RB26DETT"), Motor ("2,6 l R6 Biturbo"), Hubraum (suffix cm³), Kraftstoff (sheet picker), Aufladung (sheet picker). LEISTUNG — value input + inline segmented PS · kW · hp; provenance chips Werksangabe · Besitzerangabe · Gemessen; live helper "≈ 368 kW". DREHMOMENT — value (Nm) + provenance chips. ANTRIEB — segmented Front · Heck · Allrad; Getriebe picker. Sticky bottom bar above keyboard: tertiary "Entwurf speichern" left, Primary L "Weiter" right (≥ 50 % width). Desktop web: 2-pane — steps rail 240 left, form centre (max 560), live vehicle-card preview right.

**FS-6 Modification editor — Räder & Reifen (GAR-10).** Header: back, `headline` "Räder & Reifen", trailing "Speichern". Live preview line at top on bg.surface radius 12: "BBS LM · 19″ × 9,5J ET35 · 255/35 R19". Status segmented Verbaut · Geplant · Entfernt. FELGEN: Marke (catalogue autocomplete: BBS, OZ Racing, Rotiform, Work, Rays/Volk Racing, Enkei, Vossen, HRE …), Modell, Durchmesser (″), Breite vorne / hinten (J) side by side, ET vorne / hinten side by side, Lochkreis, switch "Mischbereifung". REIFEN: Marke, Modell, Größe vorne / hinten (masked `255/35 R19`). EINBAU: Monat/Jahr, Kosten (€ + switch "Öffentlich zeigen", off), [SIG] Rechtlicher Status + disclaimer helper. FOTOS: 3-column grid with add tile. NOTIZEN. 32 → destructive tertiary "Modifikation löschen". Sticky bottom Primary L "Speichern".

**FS-7 Conversation (MSG-02).** Header: back, avatar 32 + name `headline` + @username `caption` (stacked), trailing info. Vehicle-context card pinned at the top when started from a car (thumb 56, "Nissan Skyline GT-R R34", "Fahrzeug von @lukas.sc"). Inverted list; day separators ("Heute", "Gestern", "Mo., 3. Nov."); bubbles per §8; "Gelesen" under the last own message when receipts are on. Composer per §8 with attach sheet (Foto · Fahrzeug teilen). Request mode: top banner "@max.e46 möchte dir schreiben" + Annehmen (primary M) · Löschen (secondary M) · Blockieren (destructive tertiary).

**FS-8 Profile (PROF-01 / PROF-02).** Optional 3:1 cover full-bleed; avatar 96 overlapping the cover by 32 with a 2-pt canvas ring (no cover → avatar at top-left under the header). Name `title.m`; "@lukas.sc" `supporting` secondary; meta `caption` tertiary "Stuttgart · Mitglied seit März 2023". Stats inline (not boxes): "**3** Fahrzeuge · **128** Follower · **87** Folge ich" (`body.strong` tnum values + `supporting` labels). Bio `body`. Actions — own: "Profil bearbeiten" (secondary M) + share + QR icon buttons; other: "Folgen" (primary M) + "Nachricht" (secondary M) + more. Section "Garage": horizontal cards at 78 % width (peek) + "Alle anzeigen". Own rows: Meine QR-Codes · Gespeichert [SIG] · Einstellungen. No fake "Events/Beiträge" counts.

**FS-9 QR detail (QR-02).** Header "QR-Code" + `supporting` vehicle name. QR card per §8 with code "7H2K QXMB" and URL. 24 → Primary L "Herunterladen" (format sheet: PNG · SVG · PDF-Sticker · [SIG] Placard A5/A4) + Secondary L "Teilen". Rows: Öffentliche Seite ansehen · Sticker-Platzierung · [SIG] Scans (14-day mini bars in text.secondary + total) · "QR-Code ersetzen" (destructive, dialog explains old stickers stop working).

**FS-10 Public vehicle page (WEB-01) — Blade, phone + desktop.** Sticky top bar 56: small wordmark left; right "App laden" link + "Anmelden" (secondary S). Then exactly FS-3's hero, title, spec strip, owner row; content tabs become an anchored in-page nav (same look) over stacked sections (Übersicht, Technik, Mods, Verlauf) so everything is crawlable without JS. Phone: sticky bottom bar (bg.surface 92 % + blur, 12 padding + safe inset): **Brand** L "In der App öffnen" + Secondary L "Registrieren". Desktop: gallery 7/12 (1 large + 4 small), right 5/12 sticky card (title, spec strip, owner, CTAs). Footer: Impressum · Datenschutz · AGB · Konto löschen · DE/EN. Hero `<img>` with WebP srcset, width/height, `fetchpriority="high"`, blurhash background; < 10 KB JS.

**FS-11 Discover (DISC-01) + Results (DISC-02).** DISC-01: large title "Entdecken"; sticky search 44 "Marke, Modell, Mods oder Mitglieder"; recent searches chips + "Löschen"; "Marken" 3-column text tiles (56 high, radius 12, bg.surface; make `label.s` + real count `caption` tertiary); "Kollektionen" 16:9 cards (admin-curated: "M4 G82 Builds", "JDM Legends"); "Beliebte Mods" chips. DISC-02: content tabs "Fahrzeuge (124) · Mitglieder (8)"; chip row: "Filter" (icon + count) then removable active chips ("BMW ×" "M4 ×" "19″ ×"); `supporting` "124 Builds · Relevanz ▾" + list/grid toggle; list = vehicle cards, grid = tiles. Filter sheet: full-height, grouped sections, sticky Primary L "124 Ergebnisse anzeigen" + "Zurücksetzen". No results: illustration-free empty state + "Filter zurücksetzen".

**FS-12 Settings (SET-01) + Appearance (SET-10).** Grouped inset lists (bg.surface radius 12, rows 56, monochrome icons — no colourful iOS squares): Konto · Sicherheit · Privatsphäre · App · Daten · Hilfe · Rechtliches · Über die App ("Version 0.4.0 (Build 12)") · centred destructive "Abmelden". SET-10: four preview cards (mini phone mock-ups rendered with real tokens: Carbon, Schwarz, Hell, System), selected = 2-pt text.primary outline; applies instantly with a 200 ms crossfade.

## 14. Admin portal design (Inertia + Vue)
Same tokens and fonts; Carbon default + Light; German UI with English toggle. Sidebar 248 with groups (Übersicht · Mitglieder · Fahrzeuge & Medien · Katalog · QR · Moderation · Support · Marke & Inhalte · Konfiguration · Team & Rollen · Audit & Datenschutz · System · Einstellungen); top bar with global search + ⌘K palette + environment badge (LOCAL/STAGING/PROD in status colours) + staff menu. Page header: breadcrumb `caption`, `title.m`, actions right. **Tables:** 40-px rows, hairline grid, sticky header, server-side sort/filter/pagination, column chooser, saved views, row selection with bulk bar, tnum numbers right-aligned, status pills. **Record pages:** header (status + key actions) · tabs · right activity timeline from the audit log. **KPI tiles:** `display.m` number, `caption` label, delta in status colour, 14-day sparkline — no gradients, no icons in coloured circles. Charts: monochrome series + one accent series, every chart answers a question ("QR-Scans → Registrierungen diese Woche"). Destructive and high-risk actions use confirm dialogs with typed confirmation for irreversible ones.

## 15. Anti-AI-look rulebook
| Don't | Do instead |
|---|---|
| Purple/blue gradients, glow, glassmorphism everywhere | Flat charcoal surfaces, one red accent, blur only on the tab bar |
| Default Tailwind/shadcn look (slate greys, rounded-2xl, ring shadows) | Custom tokens (palette reset), radii 4/8/12/16, hairlines |
| ✨ sparkles for AI, emoji as icons | "KI-Vorschlag" label + Phosphor glyph |
| Bento grids, meaningless stat cards | Car cards and spec tables; stats only when real |
| Everything centred, identical card grids | Left-aligned editorial hierarchy, varied module rhythm on Home |
| Generic 3D/blob illustrations, stock gradients | Real car photography; brush/katakana at brand moments |
| Lorem ipsum, fake counts ("1.2K followers" on day one) | Real German content; designed zero states |
| Mixed icon families, random icon sizes | Phosphor + custom auto set, 16/20/24 |
| Pill buttons everywhere, radii ≥ 20 | 8-pt buttons; pills only for chips |
| Instagram feed with likes/comments | Build cards, build updates, follow/save |
| Centred "hero + 3 feature cards" landing page | Editorial landing: night photo, the QR story in 3 real steps, a real featured build, store badges |

## 16. Anti-bug rules (enforced by lint, tests, DOM audit)
No raw hex/rgb/px in components — tokens only (ESLint `react-native/no-color-literals`, custom rule for numeric style literals outside `space/size/radius`). No fixed heights on text containers. Every list virtualised (FlashList). Every image has an explicit aspect ratio. Every async action handles loading, error, retry and double-tap (disable + idempotency key). Keyboard handled with `react-native-keyboard-controller` (sticky CTAs ride above it). Android `includeFontPadding: false` + explicit lineHeight. Fonts loaded before splash hides. `PixelRatio.roundToNearestPixel` for hairline-adjacent layouts. A screen is not done until all states × themes × DE/EN × 200 % font pass design QA (`07_QA_AND_RELEASE.md`).
