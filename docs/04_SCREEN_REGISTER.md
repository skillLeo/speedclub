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
src/app/(tabs)/_layout.tsx               Headless tabs (expo-router/ui) + TabBar (<768) / Rail (768–1279) / Sidebar (≥1280)
src/app/(tabs)/(home,discover,garage,messages,profile)/_layout.tsx   Stack per tab (segment-aware)
src/app/(tabs)/(home,discover,garage,messages,profile)/v/[slug]/…   VEH-01…05 shared
src/app/(tabs)/(home,discover,garage,messages,profile)/u/[username]/… PROF-02, PROF-04 (other member) shared
src/app/(tabs)/(garage,profile)/qr/[vehicleId]/…   QR-02…04 shared by the two owner tabs; a cold link lands in Garage (ADR-164)
src/app/(tabs)/(home)/index.tsx          "/"                HOME-01
src/app/(tabs)/(discover)/discover/…     "/discover…"       DISC-*
src/app/(tabs)/(garage)/garage/…         "/garage…"         GAR-* (except wizard)
src/app/(tabs)/(messages)/messages/…     "/messages…"       MSG-* (except new message)
src/app/(tabs)/(profile)/profile/…       "/profile…"        PROF-01/03/04/05, QR-01
src/app/(tabs)/(profile)/settings/…      "/settings…"       SET-*
src/app/(modals)/…                       Modal stacks: add-vehicle wizard, published, new message, viewer, compare, share card, decision
src/app/c/[code].tsx                     In-app QR resolver → redirect to /v/[slug]
src/app/maintenance.tsx · update-required.tsx                  SYS-02 · SYS-01
src/app/dev/gallery.tsx                  DEV-01 (only when EXPO_PUBLIC_APP_ENV ≠ production)
```
**Rule:** exactly ONE `_layout.tsx` serves the five tab groups — the one inside `(home,discover,garage,messages,profile)/`. Never add another `_layout.tsx` in `(home)`, `(discover)`, `(garage)`, `(messages)` or `(profile)`. Prove this structure with a 30-minute spike at the start of Phase 1 (push `/v/[slug]` from two different tabs, check back behaviour and web URLs) before building screens on it; if it misbehaves, record an ADR and use per-tab stacks with duplicated thin route files that re-export one screen component.
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

### QR (4) · overlays: download-format sheet, revoke & reissue dialog
| QR-01 | My QR codes | /profile/qr | P1 | one row per vehicle, status |
| QR-02 | QR detail | /qr/[vehicleId] | P1 | FS-9; downloads PNG/SVG/PDF; [SIG] scans, placard |
| QR-03 | Sticker placement guide | /qr/[vehicleId]/placement | P1 | legal wording from `08_LEGAL_COMPLIANCE.md` §7 |
| QR-04 | Public page preview | /qr/[vehicleId]/preview | P1 | renders the real public page (web view on native, link on web) |

### MSG — tab "Nachrichten" (5) · tabs: Chats / Anfragen · overlays: message actions, attach sheet, delete-conversation dialog
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
