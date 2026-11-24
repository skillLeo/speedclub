# 04 — Screen Register (the build checklist)

Every route below is a deliverable. A route is **done** only when it meets the Definition of Done (all states, 3 themes, DE/EN, 200 % font, tests, design-QA pass).
Phases: **P1** = Phase 1, **P2** = Phase 2, **P3** = Phase 3. "P1-lite" = a reduced but polished version in P1, completed in P2.

## 1. Totals
| Product | Routes | Tabs/steps | Overlays | State frames | Responsive frames | Design surfaces |
|---|---|---|---|---|---|---|
| Mobile app (also the member web on phone widths) | 69 | 16 | 28 | 77 | — | 190 |
| Member web — web-only additions (Blade) | 8 | — | 3 | 4 | 26 | 41 |
| Super-admin portal | 52 | 17 | 26 | 14 | — | 109 |
| **V1 total** | **129** | 33 | 57 | 95 | 26 | **340** |
| [SIGNATURE] routes (flags) | 3 | — | 4 | 6 | — | 13 |
| Flagged future-ready admin (plans & entitlements) | 2 | — | 2 | 2 | — | 6 |
| Dev-only component gallery | 1 | — | — | — | — | 1 |
Counting rules: route = addressable screen; tab/step = in-screen view that changes main content; overlay = sheet/modal/dialog/drawer; state frame = materially different layout (loading, empty, error, offline, restricted, no results); responsive frame = tablet/desktop layout of an existing route.

## 2. Expo Router file layout (mobile/src/app) — shared routes pattern
Tabs are groups so the vehicle/member routes can be pushed **inside whichever tab opened them** (Expo Router shared routes with array groups; the shared `_layout.tsx` receives `segment` to pick the initial route per tab).
```
src/app/_layout.tsx                      Root: providers, fonts, theme, splash (AUTH-01), auth gate, app-config/maintenance/force-update gate
src/app/+native-intent.tsx               Map incoming links: strip "/app", "/C/" → "/c/"
src/app/+not-found.tsx                   SYS-03
src/app/(auth)/…                         AUTH-02…11 (stack, no tab bar)
src/app/(tabs)/_layout.tsx               Web: headless tabs (expo-router/ui) + TabBar (<768: 5 tabs) / Rail (768–1279: 5 tabs + Nachrichten) / Sidebar (≥1280: Start · Entdecken · Treffen · Forum* · Garage · Shop · Nachrichten · Profil); `_layout.native.tsx`: NativeTabs (5 tabs) behind nav.native_tabs (M5.2, 10 §1, ADR-501; *Forum behind its flag)
src/app/(tabs)/(home,discover,garage,shop,profile)/_layout.tsx   Stack per tab (segment-aware: in `(discover)` the segment pages discover/index and events/index swap with a fade)
src/app/(tabs)/(home,discover,garage,shop,profile)/v/[slug]/…   VEH-01…05 shared
src/app/(tabs)/(home,discover,garage,shop,profile)/u/[username]/… PROF-02, PROF-04 (other member) shared
src/app/(tabs)/(home,discover,garage,shop,profile)/messages/…    MSG-01/02/04/05 shared since M5.2: pushed from the Start/Entdecken header (or the rail/sidebar place) inside the tab that shows; push and deep links still open a conversation directly; a cold link lands in Entdecken (first alphabetical group)
src/app/(tabs)/(home,discover,garage,shop,profile)/events/…      EVT-01/02/04/06 shared; in Entdecken EVT-01 is the segment Treffen (no back, segmented control), elsewhere a page with back
src/app/(tabs)/(garage,profile)/qr/[vehicleId]/…   QR-02…04 shared by the two owner tabs; a cold link lands in Garage (ADR-164)
src/app/(tabs)/(home)/index.tsx          "/"                HOME-01
src/app/(tabs)/(discover)/discover/…     "/discover…"       DISC-*
src/app/(tabs)/(garage)/garage/…         "/garage…"         GAR-* (except wizard)
src/app/(tabs)/(shop)/shop/index.tsx     "/shop"            SHOP-01 (M5.2 shell while `shop` is off; catalogue M5.5; three category cards R5-3)
src/app/(tabs)/(shop)/shop/[product].tsx "/shop/[product]"  SHOP-02 (M5.5)
src/app/(tabs)/(shop)/shop/c/[category].tsx "/shop/c/[category]"  SHOP-03 (R5-3)
src/app/(tabs)/(profile)/profile/…       "/profile…"        PROF-01/03/04/05, QR-01
src/app/(tabs)/(profile)/settings/…      "/settings…"       SET-*
src/app/(modals)/…                       Modal stacks: add-vehicle wizard, published, new message, viewer, compare, share card, decision
src/app/c/[code].tsx                     In-app QR resolver → redirect to /v/[slug]
src/app/maintenance.tsx · update-required.tsx                  SYS-02 · SYS-01
src/app/dev/gallery.tsx                  DEV-01 (only when EXPO_PUBLIC_APP_ENV ≠ production)
```
**Rule:** exactly ONE `_layout.tsx` serves the five tab groups — the one inside `(home,discover,garage,shop,profile)/`. Never add another `_layout.tsx` in `(home)`, `(discover)`, `(garage)`, `(shop)` or `(profile)`. Navigation 3.0 (M5.2, 10 §1, ADR-501): tabs Start · Entdecken · Garage · Shop · Profil; Nachrichten moved from the tab bar into the Start and Entdecken headers (paper plane + unread pill "9+" next to the bell, a link) and into the web rail/sidebar as a place; the `(messages)` group is gone, its routes are shared (URLs unchanged); Entdecken's segments Builds · Treffen · Forum are the routes `/discover`, `/events`, `/forum` (Forum with M5.8, behind `forum`). Prove this structure with a 30-minute spike at the start of Phase 1 (push `/v/[slug]` from two different tabs, check back behaviour and web URLs) before building screens on it; if it misbehaves, record an ADR and use per-tab stacks with duplicated thin route files that re-export one screen component.
Web: the same tree is exported with `experiments.baseUrl = "/app"` → `/app/garage/…` etc.

## 3. Mobile app — 69 routes

### AUTH — entry & account (11) · overlays: auth-required sheet, session-expired dialog
| ID | Screen | Route | Phase | Notes |
|---|---|---|---|---|
| AUTH-01 | Splash | native splash + root loading | P1 | #0B0B0C bg, logo; hide only when fonts + theme + session restored |
| AUTH-02 | Welcome | /welcome | P1 | FS-1; Konto erstellen · Anmelden · Erst umsehen |
| AUTH-03 | Sign in | /sign-in | P1 | email, password (show/hide), "Passwort vergessen?" |
| AUTH-04 | Create account | /sign-up | P1 | email, password rules, 16+ checkbox, AGB + Datenschutz (unticked) |
| AUTH-05 | Verify email | /verify-email | P1 | 6-digit code cells, resend timer, change email |
| AUTH-06 | Forgot password | /forgot-password | P1 | neutral confirmation |
| AUTH-07 | Reset password | /reset-password | P1 | code + new password ×2 (deep link pre-fills) |
| AUTH-08 | Choose username | /username | P1 | live availability, rules, preview speedclub.de/u/name |
| AUTH-09 | Profile setup | /profile-setup | P1 | avatar, display name, city, CTA "Erstes Auto hinzufügen" / Überspringen |
| AUTH-10 | Notification primer | /notifications-primer | P2 | native only; explains before OS prompt |
| AUTH-11 | 2FA challenge | /two-factor | P2 | TOTP or recovery code |

### HOME — tab "Start" (2) · tabs: Für dich / Folge ich · overlay: card actions sheet
| HOME-01 | Home | / | P1-lite → P2 | FS-2. P1-lite = featured + Neue Builds. Web desktop: 640 column + right rail |
| HOME-02 | Notifications | /notifications | P2 | grouped by day; mark all read |

### DISC — tab "Entdecken" (4) · tabs: Fahrzeuge / Mitglieder · overlays: filters sheet, sort sheet, make picker, model picker · state: no results
| DISC-01 | Discover | /discover | P1-lite → P2 | FS-11; P1-lite = search + make tiles |
| DISC-02 | Search results | /discover/search?q=&… | P1-lite → P2 | filters/facets/sort/list-grid in P2 |
| DISC-03 | Make page | /discover/make/[make] | P2 | models with build counts, generations |
| DISC-04 | Model collection | /discover/model/[model] | P2 | generation chips, wheel-setup comparison table |
Web desktop: persistent left filter panel + 3-column grid.

### GAR — tab "Garage" (12) · steps: 4 wizard steps · overlays: category picker, cover photo action, upload queue, delete-vehicle dialog, discard-changes dialog, unit/provenance picker
| GAR-01 | My Garage | /garage | P1 | FS-4; main first, drafts, reorder, empty state |
| GAR-02 | Owner vehicle overview | /garage/[id] | P1 | public layout + owner toolbar (Bearbeiten, Mods, Fotos, QR, Sichtbarkeit) + completeness hints |
| GAR-03 | Add vehicle wizard | (modals)/add-vehicle/[draftId]/vehicle·specs·photos·review | P1 | FS-5; autosave each step; desktop 2-pane |
| GAR-04 | Published + QR | (modals)/published/[vehicleId] | P1 | brand moment; QR print animation |
| GAR-05 | Edit basics | /garage/[id]/basics | P1 | nickname, description, year, colour |
| GAR-06 | Edit specs | /garage/[id]/specs | P1 | grouped spec form, PS/kW/hp, provenance; [SIG] HU/AU month |
| GAR-07 | Manage photos | /garage/[id]/photos | P1 | drag-reorder (touch, mouse, keyboard), cover, delete, alt text, upload progress |
| GAR-08 | Photo crop & focal point | /garage/[id]/photos/[mediaId] | P1 | 4:3 + 1:1 previews, focal point; [SIG] blur tool |
| GAR-09 | Modifications | /garage/[id]/mods | P1 | grouped by category, status pills, reorder |
| GAR-10 | Add/edit modification | /garage/[id]/mods/[modId] (new?category=) | P1 | FS-6; category-specific fields |
| GAR-11 | Build history | /garage/[id]/history | P1 | timeline, add note, hide entries |
| GAR-12 | Visibility & sharing | /garage/[id]/visibility | P1 | public/unlisted/private, show owner on QR page, plate reminder |

### VEH — vehicle view (5, shared in every tab) · tabs: Übersicht/Technik/Mods/Verlauf · overlays: share sheet, more-actions · state: Fahrzeug nicht verfügbar
| VEH-01 | Vehicle profile | /v/[slug] | P1 | FS-3 |
| VEH-02 | Modification detail | /v/[slug]/mods/[modId] | P1 | category spec table, photos, "Ähnliche suchen" |
| VEH-03 | Gallery grid | /v/[slug]/gallery | P1 | photo categories |
| VEH-04 | Image viewer | (modals)/viewer | P1 | pinch/zoom, swipe, drag-dismiss |
| VEH-05 | Build update detail | /v/[slug]/updates/[updateId] | P1 | before → after |
Web desktop: gallery 7/12 + sticky spec/owner card 5/12.

### QR (4, renamed STK in M5.4: 10 §2.1, see §7; the old routes redirect) · overlays: download-format sheet, revoke & reissue dialog
| QR-01 | My QR codes | /profile/qr | P1 | one row per vehicle, status |
| QR-02 | QR detail | /qr/[vehicleId] | P1 | FS-9; downloads PNG/SVG/PDF; [SIG] scans, placard |
| QR-03 | Sticker placement guide | /qr/[vehicleId]/placement | P1 | legal wording from `08_LEGAL_COMPLIANCE.md` §7 |
| QR-04 | Public page preview | /qr/[vehicleId]/preview | P1 | renders the real public page (web view on native, link on web) |

### MSG — "Nachrichten" (5; a tab until M5.2, now in the Start/Entdecken header and the web rail/sidebar, 10 §1) · tabs: Chats / Anfragen · overlays: message actions, attach sheet, delete-conversation dialog
| MSG-01 | Inbox | /messages | P1 placeholder → P2 | P1 shows designed "Bald verfügbar" state only in APK #1 |
| MSG-02 | Conversation | /messages/[conversationId] | P2 | FS-7; vehicle context card; realtime + polling |
| MSG-03 | New message | (modals)/new-message | P2 | member search picker |
| MSG-04 | Request detail | /messages/requests/[conversationId] | P2 | no read receipt; Annehmen/Löschen/Blockieren & melden |
| MSG-05 | Conversation info | /messages/[conversationId]/info | P2 | member, shared vehicle, mute, block, report, delete |
Web desktop: split view 360 + thread.

### PROF — tab "Profil" (4) · tabs: Follower / Folge ich · overlays: avatar picker, profile more-actions
| PROF-01 | My profile | /profile | P1 | FS-8 |
| PROF-02 | Member profile | /u/[username] | P2 | Folgen, Nachricht, more (share, report, block) |
| PROF-03 | Edit profile | /profile/edit | P1 | avatar, cover, name, username (rate-limited), city, bio |
| PROF-04 | Followers / Following | /profile/connections · /u/[username]/connections | P2 | search, remove follower |

### SET — settings (18) · overlays: sign-out dialog, delete-account confirm (re-auth), revoke-session dialog, recovery-codes sheet · web desktop: 280 list + detail
| SET-01 | Settings home | /settings | P2 | FS-12; footer "Version x.y.z (Build n)" |
| SET-02 | Account | /settings/account | P2 | email, username, links to security |
| SET-03 | Change email | /settings/account/email | P2 | re-auth + code to new address |
| SET-04 | Change password | /settings/security/password | P2 | revokes other sessions option |
| SET-05 | Two-factor setup | /settings/security/two-factor | P2 | QR + manual key, confirm code, recovery codes |
| SET-06 | Sessions & devices | /settings/security/sessions | P2 | revoke one / all others |
| SET-07 | Privacy & contact | /settings/privacy | P2 | who can message, show in search, search engines, show owner on QR page, read receipts |
| SET-08 | Blocked accounts | /settings/privacy/blocked | P2 | unblock |
| SET-09 | Notifications | /settings/notifications | P2 | per-type push/email toggles, quiet hours |
| SET-10 | Appearance | /settings/appearance | P1 | FS-12; Carbon/Schwarz/Hell/System (needed in P1 for theme QA) |
| SET-11 | Language & units | /settings/language | P2 | DE/EN; PS (kW) · kW (PS) · hp |
| SET-12 | Export my data | /settings/data/export | P2 | queued ZIP, email link |
| SET-13 | Delete account | /settings/data/delete | P2 | consequences, re-auth, confirm |
| SET-14 | Help & FAQ | /settings/help | P2 | CMS articles |
| SET-15 | Contact support | /settings/help/contact | P2 | creates support ticket (ADM-25) |
| SET-16 | My reports & decisions | /settings/reports | P2 | DSA status list |
| SET-17 | Legal list | /settings/legal | P1 | Impressum, Datenschutz, AGB, Community-Richtlinien, Lizenzen |
| SET-18 | Legal document viewer | /settings/legal/[doc] | P1 | CMS markdown, versioned |

### SAFE (1) · overlays: report flow sheet (reason → details → sent), block dialog
| SAFE-01 | Decision detail | (modals)/decision/[id] | P2 | statement of reasons + appeal |

### SYS (3)
| SYS-01 | Force update | /update-required | P2 | from app-config min version |
| SYS-02 | Maintenance | /maintenance | P2 | from app-config |
| SYS-03 | Link not found / QR revoked | +not-found, c/[code] states | P1 | |

### [SIGNATURE] routes (behind flags)
| PROF-05 | Saved builds | /profile/saved | P2 | `sig.saved_builds` |
| VEH-06 | Compare builds | (modals)/compare?a=&b= | P2 | `sig.compare` |
| VEH-07 | Share card preview | (modals)/share-card/[vehicleId] | P2 | `sig.share_cards`; 9:16 + 1:1 |
| DEV-01 | Component gallery | /dev/gallery | P1 | every component × state × theme; used by design QA |

## 4. Member web — web-only additions (Laravel Blade, 8) · overlays: sign-up prompt, (cookie banner + settings only if optional analytics is ever enabled — not in V1)
| ID | Screen | URL | Phase | Notes |
|---|---|---|---|---|
| WEB-01 | Public vehicle page | /c/{code}, /C/{code} → 302 /v/{slug}; /v/{slug} | P1 | FS-10; OG + JSON-LD; LCP < 2.5 s; logged-in web users → /app/v/{slug} |
| WEB-02 | Public member page | /u/{username} | P1 | garage list, OG |
| WEB-03 | Landing | / | P1 | brand layer; the QR story; featured builds; store badges |
| WEB-04 | Get the app | /app-laden | P2 | platform detection, store badges, APK note for testers on staging |
| WEB-05 | Public account deletion | /konto-loeschen | P2 | Google Play requirement |
| WEB-06 | QR resolver states | (rendered by /c/{code}) | P1 | revoked · private · not found |
| WEB-07 | Email action landing | /email/{action} | P2 | verify/reset links on desktop → continue in browser or app |
| WEB-08 | Public legal pages | /impressum, /datenschutz, /agb, /community-richtlinien | P1 | SSR from CMS, ≤ 2 clicks from every page |
| WEB-09 | Report form (DSA Art. 16, no account) | /melden | P2 (M2.6) | fields of `08_LEGAL` §4: explanation, URL, optional contact, good-faith statement; Turnstile when configured. On launch add it to community §8, terms §8 and privacy §6 (ADR-116) |
| WEB-10 | Contact form | /kontakt | P2 (M2.5) | creates a support ticket (`06_ADMIN_SPEC` ADM-25) |
| WEB-13 | Public meet (09 §9) | /e/{slug} | P4 (M4.16) | guest render only; after-RSVP place → city; sample/unlisted noindex; ICS; OG 1200×630 + 1080×1080 (ADR-459) |
| WEB-14 | Public business (09 §9) | /b/{slug} | P4 (M4.14/M4.16) | Impressum block, JSON-LD, flag `businesses` |
| WEB-15 | Public brand (09 §9) | /brands/{slug} | P4 (M4.14/M4.16) | flag `parts_catalogue` |
| WEB-16 | Magic-link hand-off (09 §9) | /auth/magic | P4 (M4.6) | redirects to the member web AUTH-13 |
Plus static: `/robots.txt`, `/sitemap.xml` (public vehicles + members that allow search engines), `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`.
**Responsive frames (26):** desktop ≥ 1280 and tablet 768 layouts of HOME-01, DISC-01/02, GAR-01/02/03, VEH-01, MSG-01/02, PROF-01/02, SET-01, WEB-01 … (screenshot matrix covers them).

## 5. Super-admin portal — 52 routes (Inertia + Vue, `/admin/*`)
| ID | Screen | URL | Notes (tabs / overlays) |
|---|---|---|---|
| ADM-01 | Sign in | /admin/login | separate staff guard + cookie |
| ADM-02 | 2FA challenge | /admin/two-factor-challenge | TOTP / recovery code |
| ADM-03 | 2FA enrol (mandatory) | /admin/two-factor/setup | blocks all admin routes until confirmed |
| ADM-04 | Staff password reset | /admin/forgot-password, /admin/reset-password/{token} | |
| ADM-05 | Access denied | (403 page) | |
| ADM-06 | Dashboard | /admin | queues (reports, appeals, GDPR due, failed jobs) + KPIs + first-run state |
| ADM-07 | Global search | /admin/search | members, vehicles, QR codes, cases; ⌘K palette overlay |
| ADM-08 | Staff alerts | /admin/alerts | |
| ADM-09 | Members list | /admin/members | server table, saved views, bulk |
| ADM-10 | Member record | /admin/members/{id} | tabs: Übersicht, Fahrzeuge, Sicherheit & Sitzungen, Meldungen, Nachrichten-Metadaten, Audit, Datenschutz/Einwilligungen; overlays: edit drawer, restrict/suspend sheet, send reset link, force password change, revoke sessions, reset 2FA (four-eyes), view-as (read-only), bulk-result panel |
| ADM-11 | Vehicles list | /admin/vehicles | |
| ADM-12 | Vehicle record | /admin/vehicles/{id} | tabs: Details, Fotos, Mods, QR, Verlauf, Meldungen; hide dialog |
| ADM-13 | Media review queue | /admin/media-review | [AI] triage scores when enabled |
| ADM-14 | Makes / models / generations | /admin/catalog/makes | tab "Anfragen" (member catalogue requests) |
| ADM-15 | Mod categories & field schema | /admin/catalog/mod-categories | field editor |
| ADM-16 | Brands | /admin/catalog/brands | normalise / merge |
| ADM-17 | CSV import | /admin/catalog/import | dry-run diff → apply |
| ADM-18 | QR registry | /admin/qr | |
| ADM-19 | QR detail | /admin/qr/{id} | scans, history, revoke/reissue |
| ADM-20 | Reports queue | /admin/moderation/reports | tabs Neu · In Prüfung · Entschieden · Einsprüche |
| ADM-21 | Case detail | /admin/moderation/cases/{id} | evidence, history, decision composer with SoR templates |
| ADM-22 | Messaging safety | /admin/moderation/messages | reported threads only |
| ADM-23 | Rules | /admin/moderation/rules | keyword lists, rate limits |
| ADM-24 | SoR templates | /admin/moderation/templates | |
| ADM-25 | Support tickets | /admin/support/tickets | assign drawer |
| ADM-26 | Ticket detail | /admin/support/tickets/{id} | |
| ADM-27 | Macros | /admin/support/macros | |
| ADM-28 | Brand & theme | /admin/brand | logo, splash/hero images, accent set, default theme |
| ADM-29 | Home curation | /admin/content/home | featured builds, collections |
| ADM-30 | Announcements | /admin/content/announcements | in-app banners |
| ADM-31 | Legal documents | /admin/content/legal | versioned, DE/EN |
| ADM-32 | Help content | /admin/content/help | |
| ADM-33 | Email & push templates | /admin/content/templates | |
| ADM-34 | Draft preview | /admin/content/preview | mobile + web × 3 themes |
| ADM-35 | Version history | /admin/content/versions | diff viewer, rollback |
| ADM-36 | Feature flags | /admin/config/flags | four-eyes for production-impacting flags |
| ADM-37 | Remote config | /admin/config/remote | min version, force update, maintenance |
| ADM-38 | Release register | /admin/config/releases | builds, APK checksums, changelog |
| ADM-39 | Staff list | /admin/team | invite drawer |
| ADM-40 | Staff detail | /admin/team/{id} | |
| ADM-41 | Roles | /admin/team/roles | |
| ADM-42 | Permission matrix | /admin/team/permissions | diff before save |
| ADM-43 | Approval requests | /admin/team/approvals | four-eyes queue |
| ADM-44 | Audit log | /admin/audit | event drawer, hash-chain status |
| ADM-45 | GDPR requests | /admin/privacy/requests | deadlines (1 month) |
| ADM-46 | GDPR request detail | /admin/privacy/requests/{id} | evidence of completion |
| ADM-47 | Retention settings | /admin/privacy/retention | |
| ADM-48 | System health | /admin/system/health | spatie/laravel-health results, cron/queue heartbeat |
| ADM-49 | Jobs & queues | /admin/system/jobs | failed jobs retry/forget |
| ADM-50 | Integrations | /admin/system/integrations | mail, Pusher, Expo push, storage, AI provider status (no secrets shown) |
| ADM-51 | My staff account | /admin/account | password, 2FA, sessions |
| ADM-52 | Org settings | /admin/settings | company data for Impressum, support email, locale |
| ADM-F1 | Plans (flagged) | /admin/memberships/plans | `premium.enabled` scaffold, no payments |
| ADM-F2 | Entitlements (flagged) | /admin/memberships/entitlements | manual grant/revoke, audited |
Pattern states: table loading, empty, no results, error, record not found, 403 view-only, analyst read-only, bulk partial failure, session expiring, maintenance active, first-run dashboard, 3 queue-zero frames.

## 6. Flow ↔ route coverage (each flow is an E2E test)
F1 AUTH-02→04→05→08→09→(10)→GAR-01 · F2 GAR-01→03(1–4)→04→09 · F3 GAR-09→10→VEH-01(Verlauf) · F4 WEB-01/06 · F5 DISC-01→02→VEH-01→PROF-02→MSG-02 · F6 MSG-01(Anfragen)→MSG-04→SAFE report · F7 PROF-01→SET-01→07/10/11/05 · F8 SET-13 + WEB-05 · A1 ADM-09→10 · A2 ADM-20→21 · A3 ADM-28→34→35 · A4 ADM-39→40→43.

## 7. Phase 5 additions (SPEED CLUB 2.1, `docs/10_CLIENT_ROUND_1.md` §11 + §16; filled in per module)
| ID | Screen | Route | Notes |
|---|---|---|---|
| GAR-07-plateBlur | Plate blur review after a photo pick (PlateBlurEditor) | overlay of every upload flow | M5.9a, ADR-509: switch "Kennzeichen unkenntlich machen" default on, suggested rectangle, move/resize/add/remove |
| GAR-01-plateCheck | "Kennzeichen prüfen" card + sheet | overlay on `/garage` | M5.9a: one-time check of existing photos; keep / blur / later |
| DEX-01 | Mein Dex | `/dex` | M5.9b ★: progress, filter chips, card grid, "???" silhouettes; from Profil |
| DEX-02 | Sticker scanner | `/scan` (full-screen modal) | M5.9b: camera QR, torch, haptic, offline queue; web: "Spotten geht nur in der App" |
| DEX-03 | Spot reveal | `/dex/spot/[spotId]` (full-screen modal) | M5.9b ★: card flip, rarity, NEU/duplicate, First Spotter foil |
| DEX-04 | Dex card | `/dex/car/[vehicleId]` | M5.9b |
| DEX-05 | Sets | `/dex/sets` | M5.9b: binder pages with empty slots |
| DEX-06 | Owner spot stats | `/vehicles/[id]/spots` (owner) | M5.9b; embedded in INS-01 in M5.7 |
| BDG-01 | All badges | `/profile/badges`, `/u/[username]/badges` | M5.9d: earned first; hidden "???" + hint on the own list only |
| INV-01 | Freunde einladen | `/settings/invites` | M5.9d: 5 codes, share/copy, status; both sides get "Crew Starter", nothing else |
| INV-02 | Invite link | `/join/[code]` | M5.9d: holds the code, opens sign-up (AUTH-12); App Link `/join/` (live) |
| HOME-01-cotd | Car of the Day lead module + owner story editor | overlay on `/` | M5.9d, ADR-510 |
| PROF-01-level / PROF-01-badge | Level sheet, badge detail sheet | overlays on PROF-01/02 | M5.9d |
| WRP-01 | Season Wrapped story player | `/wrapped/[season]` (full-screen modal) | M5.9e |
| WEB-17 | Invite landing (Blade) | `/join/{code}` | M5.9d: inviter line, opens the app or sign-up with the code; unknown/used code → plain landing without inviter |
| ADM-62 | Spots (Trust & Safety) | `/admin/moderation/spots`, `/admin/moderation/spots/{spot}` | M5.9b: list + record, signals burst / same device (ADR-511) / city hop, "Spot entfernen" (`moderation.view` / `moderation.decide`) |
| ADM-63 | Abzeichen | `/admin/content/badges`, `/new`, `/{key}` | M5.9d: list, form with rule builder over whitelisted metrics, preview, activate, "Jetzt anwenden" (`content.view` / `content.edit` + recent password) |
| ADM-64 | Car of the Day | `/admin/content/car-of-the-day` | M5.9d: today + 14 days ahead + 14 back, "Anderes Auto festlegen", "Tag aussetzen" (`content.view` / `content.edit` + recent password) |
| ADM-66 | Shop-Produkte | `/admin/shop/products`, `/new`, `/{product}` | M5.5 (ADR-524): list with filters/presets, reorder, show/hide, delete (recent password), product editor (price incl. MwSt., variants, Kaufweg Online-Shop/Sticker-Designer, photos 4:5 with focal point, preview), atom `shop.manage` |
| ADM-67 | Shop-Banner | `/admin/shop/banners` | M5.5: hero banners (one active), photo ≥ 1600 px with 16:9 crop preview, link to product/category, delete with confirm word + password |
| ADM-68 | Forum-Moderation | `/admin/forum` | M5.8 (ADR-526): SplitQueue tabs Vormoderation · Gemeldet · Themen · Entfernt; thread pane with pin/lock/move/merge/solution, hide (DSA remove_content), forum ban (DSA restriction `forum`); `moderation.view`/`moderation.decide`, ban `members.restrict` |
| ADM-69 | Forum-Kategorien | `/admin/forum/categories` | M5.8: category tree, create/edit drawer, reorder per level, archive, delete when empty, "Marken abgleichen"; make/Bundesland categories read-only; `moderation.rules` |
| ADM-10-wrapped | Member record tab "Wrapped" | `/admin/members/{member}?tab=wrapped` | M5.9e: seasons, "Vorschau erzeugen", staff-only card PNGs (`members.view` + `support.view`; generate + `support.reply`) |
| STK-01 | Meine Sticker (hub) | `/stickers` (was `/profile/qr`, 301 on the web) | M5.4 (10 §2.2): one card per car, live sticker on a black vinyl stage, Aktiv/Gesperrt, scans this week (tnum), Gestalten · Bestellen · Herunterladen with the reason an action is not available yet; no published car → badged "Beispiel" sticker without a code + "Fahrzeug hinzufügen" |
| STK-02 | Sticker detail | `/stickers/[vehicleId]` (was `/qr/[vehicleId]`) | M5.4 ★ (QR-02 renamed): FS-9 detail, downloads, revoke & reissue, scans, the STK-06 order row (replaces the M4.9 sticker-shop row) |
| STK-02-preview | Public page preview | `/stickers/[vehicleId]/preview` (was `/qr/[vehicleId]/preview`) | M5.4 (QR-04 renamed; 10 §11 gives STK-04 to the stats) |
| STK-03 | Sticker placement guide | `/stickers/[vehicleId]/placement` (was `/qr/[vehicleId]/placement`) | M5.4 (QR-03 renamed); legal wording from `08_LEGAL_COMPLIANCE.md` §7 |
| STK-04 | Scan stats | `/stickers/[vehicleId]/stats` | M5.4 (10 §2.3): 30-day line, this/last week, first scan, total; owner only; "Geteilte Links" says "Noch nicht erfasst" while the server sends null |
| STK-05 | Sticker designer | `/stickers/[vehicleId]/design` | M5.4 ★ (10 §2.3): live preview Flach · Am Auto · Originalgröße, six templates and every option, undo/redo, autosave with `base_version` (409 → "Neuere Version laden" / "Meine Version behalten"), Scan-Test gate before ordering (ADR-508), controls in a non-modal dock, side by side from 900 |
| STK-06 | Sticker bestellen | `/stickers/[vehicleId]/order` | M5.4 (10 §2.3): opens the server's Shopify cart link outside the app (ADR-502); "Erst der Scan-Test" before a passed test; "Bestellung bald verfügbar" while the store is not configured |
| STK-07 | Design-Versionen | `/stickers/[vehicleId]/history` | M5.4 (10 §2.3): the saved versions of a design |
| EVT-07 | Check-in | `/events/[slug]/checkin?code=` | M5.6 (10 §4, flag `events.checkin`, off by default): the page the organiser's QR opens; always asks before checking in; "War dabei" afterwards with the profile switch; no location is stored |
| INS-01 | Statistiken | `/insights` (account), `/vehicles/[id]/insights` (one car) | M5.7 (10 §6.1, owner only): this week vs last week in plain words (never a red loss or a percentage drop), 30-day chart (views accent, scans neutral), sources, "Diese Woche" (scans, Dex spots, new followers, saves, reactions), per-page breakdown; staff in view-as → "Nur für den Besitzer"; entry from PROF-01 and the owner's vehicle (with the build goal) |
| FOR-01 | Forum (Entdecken › Forum) | `/forum` | M5.8 (10 §7.2): search, category chips, sort Aktiv · Neu · Unbeantwortet · Gelöst (sheet), thread rows (title, category + vehicle chip, last activity, reply count tnum, "Gelöst", "Beispiel" on samples); a segment page of Entdecken (hidden control from 1280, the sidebar lists Forum) |
| FOR-02 | Forum category | `/forum/c/[slug]` | M5.8: FOR-01 filtered to one category (same screen), sub-categories as chips |
| FOR-03 | Thread | `/forum/[id]` (`?post=` marks a reply) | M5.8 ★: opening post (Markdown subset from the server's text tree, up to 6 photos, attachments), solution card, replies one level deep, visible "Hilfreich" counts (forum only), "Als Lösung markieren" (author), subscribe, share, report (`forum_post`), edit/delete own; locked/pending/rejected/removed/merged, forum-ban notice |
| FOR-04 | Composer | `/forum-composer` (modal sheet) | M5.8: title ≤ 120 with "Ähnliche Themen" while typing, category, text, tags, ≤ 6 photos (plate-blur step), attach a car; discard guard; pre-moderation and rate-limit answers |
| FOR-05 | Meine Themen | `/forum/mine` | M5.8: tabs Gestartet / Abonniert, own threads with their state |
| SHOP-01 | Shop (tab) | `/shop` (an old `?category=sticker\|apparel\|accessories` forwards to SHOP-03 with `replace`) | M5.2: the tab and route (SF `bag`, Material `shopping_bag`, Phosphor `Bag`). Flag `shop` off (app-config, or the server's 404 `feature_disabled`): the M5.2 shell stays (photo, "Der SPEED CLUB Shop zieht hier ein", where paying happens, "Zu deinen Stickern"; ADR-519). R5-3 (client round 5, replaces the M5.5 catalogue on this route) with `shop` on: large title, no cart, exactly three category cards in the server's order from `GET /shop` `categories[]` (Sticker · Kleidung · Accessoires; a key the server leaves out follows in the app's order), nothing else: no product wall, no chips, no sticker block, no hero banner of its own. R5DQ-01: every `available` category (server `status`, R4-3.2) is a lead, in the server's order: its first product's photo (R5DQ-22; else the bundled frame; never the banner, which stays SHOP-03's hero; "Beispiel" on a sample), full-bleed 4:5 on phones; from 768 a split (R5DQ-27): the 4:5 photo on about 5 of 12 columns, radius 12 with a hairline edge, the words beside it; name `title.2` in the app's words (R4DQ-27) with a caret, one line, no pill; the whole card links to SHOP-03. The `coming_soon` ones follow as a compact row of 1:1 tiles (phones edge to edge, 2 apart; from 768 a quarter column each; stacked as rows at a large font: an 88 photo with the name and the "Bald verfügbar" pill beside it, R5DQ-21), "Bald verfügbar" on the photo over `scrim.top`, name `headline` (`callout.strong` from 1280), never hyphenated, no press, `aria-disabled`, never an empty list. States: the lead and two tile skeletons, error + retry, offline (banner/cached), QA empty = the app's defaults. testIDs `SHOP-01.category.<key>` (`.photo`, `.title`, `.body`, `.sample`; `.soon` on a coming tile), `SHOP-01.soon` |
| SHOP-02 | Produkt | `/shop/[product]` (slug or ULID) | M5.5 (10 §3, m5.5-contract §3.3): gallery (swipe with page pill on phones and tablets, stacked beside the facts from 1280; tap = zoom viewer), category, name, gross price "inkl. MwSt., zzgl. Versand" (PAngV), variant chips (a radio group, informational; a chosen one takes the server's cart permalink), description, "Versand" (the store's shipping policy); ONE primary from the server's `buy`: `external` "Im Shop kaufen" opens the server's https address in the in-app browser / a new tab, `designer` "Sticker gestalten" → STK-01 (guests sign in first), unavailable disabled with "Bald im Shop erhältlich". No cart, payment or price maths in the app; 404 → "Dieses Produkt gibt es nicht mehr"; flag off → the shell. R5-3: back returns to the SHOP-03 it came from; opened cold, to the product's category page. R5-4: one photo is a plain page, the pager (a ScrollView) only from two photos (no `touch-action: none` scroll trap on the web) |
| SHOP-03 | Kategorie | `/shop/c/[category]` (`sticker`\|`apparel`\|`accessories`) | R5-3 (client round 5: "if user goes into sticker, then all data and sticker is shown"): large title = the category (app's word) with back to SHOP-01. Flag off → the shell. Unknown key → "Diese Kategorie gibt es nicht" + "Zum Shop". `coming_soon` (server status; the default only until the head answers) → "Bald verfügbar" state: the category photo, "Kleidung kommt bald" (no pill over it, R5DQ-09), one line, "Zum Shop"; never an empty list, no product request. `available`: the admin's hero banner when it opens this category (not a link here) or a product listed here (opens SHOP-02); the wall of the category's products (2 columns of 4:5, 3 from 768, 4 from 1280, 2 px, 0 radius; name, gross price "inkl. MwSt.", "Beispiel" on samples; cursor paging) linking to SHOP-02; for stickers "Dein Sticker" under it: what the sticker does (QR opens the build page; people at meets scan instead of asking; you decide what the page shows, no plate; scans in your own insights; one sticker per car, designed in the app) and ONE primary "Sticker bestellen" (designer STK-05 of the member's main car, else STK-01; guests sign in first). States: wall skeleton with the banner's block above it while a banner may lead (R5DQ-18), empty (badged sample, then the sticker block; elsewhere "Zum Shop"), error + retry, offline. testIDs `SHOP-03.*` |
| HOME-01-header | Start header: SCAN · bell · Nachrichten | overlay on `/` | M5.2 (10 §1): Nachrichten as a link "Nachrichten, 3 ungelesen", pill tnum "9+"; below 768 and under native tabs only (rail/sidebar list it from 768 on the web) |
| DISC-01-segments | Entdecken › Builds · Treffen · Forum | `/discover`, `/events`, `/forum` | M5.2 (10 §1): SegmentedControl in the sticky band over each page's own search, swipe between pages (40 % or fling), each page its own route and deep link; Treffen behind `events`, Forum behind `forum` (M5.8); bell + Nachrichten in the header; the Treffen scope chip of DISC-01 is gone |
| EVT-01 (segment) | Treffen as Entdecken's segment | `/events` | M5.2: in the Entdecken stack the tab title "Entdecken", no back, segmented control, search `q` (title, city); pushed elsewhere "Treffen" with back (also with search) |
| MSG-01 (pushed) | Nachrichten inbox | `/messages` | M5.2: pushed from the header with back (phones, native tabs); a destination of the rail/sidebar without back from 768 on the web |
Flows: F17 Forum (M5.8) · F18 STREET DEX scan → spot → reveal → Dex → sets → owner alert → privacy (M5.9b) · F19 Build Journey/Score (M5.9c) · A7 admin publish (M5.1).

## 8. Client round 4 additions (`docs/11_CLIENT_ROUND_4.md`, 2026-11-21)

| ID | Screen | Route | Notes |
|---|---|---|---|
| INTRO-01…04 | Einführung | `/intro` (modal) | R4-1.4: once per account after the first sign-in (`me.intro_seen_at`, `POST me/intro/seen`); four pages, skippable; again from Einstellungen › Hilfe |
| CREW-00 | Crews | `/crews` | R4-2.3: fourth Entdecken segment (ADR-530) and a sidebar place on ≥ 1280; search, Bundesland, sort Name/Neueste, never by size |
| CREW-01 | Crew | `/crews/[slug]` | crew page; the viewer's action by `viewer.state`; report; old slug → new slug |
| CREW-02 | Crew gründen / bearbeiten | `/crews/new`, `/crews/[slug]/edit` | form with logo/cover (plate-blur flow), discard guard |
| CREW-03 | Crew verwalten | `/crews/[slug]/manage` (`/crews/[slug]/requests` opens the requests tab) | requests, invites, members, founder hand-over, delete |
| CREW-04 | Meine Crews | `/crews/mine` | own crews incl. hidden/removed states |
| CREW-05 | Einladungen | `/crews/invites` | accept / decline crew invites |
| ADM-80 / ADM-81 | Crews (admin) | `/admin/crews`, `/admin/crews/{id}` | list and detail with hide/unhide/remove/restore (staff actions) |
