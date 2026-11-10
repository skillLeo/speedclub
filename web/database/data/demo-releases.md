# SPEED CLUB — Releases

Entries are appended by `scripts/build-apk.ps1` and completed by the release engineer (changes, known issues, test status — only what actually ran).

## 0.1.0 (Build 1) - lan - 2026-11-02 08:54
- APK: releases/android/speedclub-0.1.0-b1-lan-20261102-0816.apk (51.2 MB)
- SHA-256: 8739A8E1BC83555E2852FD48FC9D8F805EB329238B4BCF2F13558E9A5383AC84
- Signed by: CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE (certificate SHA-256 ae6e9844fccec00e4f25641aca1a2f1e9ffec4d05023bc34727598291876749f)
- API: http://192.168.110.92:8080
- Changes: M1.0 toolchain spike build, not a release. Built on the Windows PC; by timestamp the tree was `c6c8e4b` (with the in-place native build of ADR-108) plus uncommitted work; the Android build chain (prebuild, Gradle, release signing, apksigner) was proven end to end. The APK file is on the Windows PC only, not on this Mac.
- Known issues (Low): none recorded for this build. Cleartext HTTP to the LAN address is allowed in `lan` builds by design.
- Test status: M1.0 spike only. No verify, e2e, visual or security gate was run against this APK. Install and launch results were not recorded in this entry, so none are claimed. Maestro: not recorded.

## 0.1.0 (Build 1) - lan - 2026-11-02 14:48
- APK: releases/android/speedclub-0.1.0-b1-lan-20261102-1430.apk (35.7 MB)
- SHA-256: 1CC5492A8DB095989675B9049551E03D3C7AF6D0D282DD6D552CE61235D80E27
- Signed by: CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE (certificate SHA-256 ae6e9844fccec00e4f25641aca1a2f1e9ffec4d05023bc34727598291876749f)
- API: http://192.168.110.92:8080
- Changes: M1.0 toolchain spike build, not a release. Built on the Windows PC at the end of M1.0 and M1.1 (by timestamp the tree around `949f4e1`, theme runtime, fonts, icons and app skeleton, plus the shared-routes spike of ADR-101). Commits since the first spike build: `54e96a1` (Laravel skeleton), `09a9444` (QA harness), `99cf601` (seed photography), `949f4e1` (mobile skeleton). The APK file is on the Windows PC only, not on this Mac.
- Known issues (Low): BUG-1 (Android hardware back left the app on Android 13-15) was open when this was built; the fix is ADR-117 and was not yet verified on a device (see HANDOFF). No other issues were recorded for this build.
- Test status: M1.0 spike only. No verify, e2e, visual or security gate was run against this APK. HANDOFF records, for M1.0, that the shared-routes spike passed on web (ADR-101) and that `nav-shared-routes.yaml` passed 3/3 on the Android emulator; the log does not tie that run to this exact file. Install result of this file not recorded.

## 0.1.0 (Build 2) - lan - 2026-11-08 01:38
- APK: releases/android/speedclub-0.1.0-b2-lan-20261108-0114.apk (54.6 MB)
- SHA-256: 592311CA3D88091E167939DEFF8BA3661216E988BF84F65D9B26356185C29AFC
- Signed by: CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE (certificate SHA-256 95ef800df2d5d92b0f8ca9c9ded0b71bf96b0b82389284b21e8e24863002f079)
- API: http://192.168.110.51:8080
- Built from: `2e545e9`. Only `81cb418` followed (visual module-tier baselines and the client preview, ADR-188); it changes no app code.
- Web package (same release, built 2026-11-08 from `81cb418`, `mobile/` clean): `releases/web/speedclub-web-0.1.0-20261108-0144.zip` (30.2 MB, 19 152 entries), SHA-256 `5b69e5cecfda760449253094d041bf103fc7bbb06783b9aa2ddbbd5f6b8c57a2`. Dry run under local Apache + PHP-FPM with a scratch database passed (`docs/DEPLOY.md`, dry run notes 2026-11-08). Its legal texts still hold `[[…]]` placeholders: not for a public host.
- Changes (since Build 1, `48a5ccf`..`81cb418`):
  - M1.2/M1.3: design system primitives, DEV-01 gallery and navigation shell (`093e8a2`); Android 13-15 hardware back (`e5198f1`, ADR-113/117); search bar focus, toasts above sticky CTA bars, reset link on native, discard guard re-dispatch (`b9b2657`, `821e1ff`, `ec9f950`).
  - M1.4: Laravel foundation: data model, real catalogue, demo data, media, audit, app-config (`4e058ae`).
  - M1.5: member auth with e-mail codes, profile and settings API (`ddee725`) and screens (`d9006b6`); Space toggles controls on web (`4511d33`).
  - M1.6: garage domain and public read API (`e31df27`); garage and vehicle profile screens (`132763f`).
  - M1.7: QR service, public Blade pages, OG images and sitemap (`e5bf22a`); QR screens (`132763f`); public avatar parity (`751d24e`).
  - M1.8: home feed, make tiles and text search (`f37d39d`); Home, Discover, search and Messages placeholder (`113885d`); mod legal status off in Phase 1 (ADR-153).
  - M1.9: local stack on macOS (`8a82041`, ADR-157); rate limiter without 500s (`05b565c`), Symfony 7.4.23 advisories (`5970dfc`), search reads `vehicle_search` (`c587585`), public pages within Lighthouse budgets (`f29a7dc`), e2e green on Chromium and WebKit (`4d7f03f`); bug hunt (50 findings), security rounds 10-11b and design gate round 3 (`9d8b209`, ADR-160 to 187); web auto glyphs regenerated (`2e545e9`).
  - M1.10: module-tier visual baselines (`81cb418`, after this APK); this APK, the web package and its dry run.
  - Tooling: QA lock and qa-run fixes (`48f928b`, `839eed3`, `8972641`, `c70ad34`), ninja download (`9a8ff3d`), MariaDB start (`0b412a7`).
- Known issues (Low):
  - Maestro flows and native-device runs were not done: no emulator on the Mac (owner action OA-9). So BUG-1 (Android 13-15 hardware back, rated High in HANDOFF, fix applied per ADR-117) is still unverified: `nav-hardware-back.yaml` must run on this APK. SEC-S-05 (native pending logout) is verified in code and Jest only.
  - Open Low design and security findings are listed in their reports: `docs/reports/design-qa/phase-1/` and `docs/reports/security/phase-1.md` (17 Low and 11 Info open, none blocking).
  - `lan` target: cleartext HTTP to the LAN address by design; not a build for testers outside the local network.
  - New upload key (created 2026-11-07, certificate SHA-256 above): testers must uninstall any older build (signed with `ae6e9844…`) before installing this one.
- Test status (`docs/reports/phase-1/verify-20261108-003931.md`, commit `2e545e9`, mode full): all 12 gates PASS: design tokens, custom icons, mobile verify (tsc, eslint, i18n, Jest 150 suites, 2 073 tests), Laravel verify (pint, phpstan, Pest 3 246 tests, audit), Laravel perf probes (5 tests), web assets verify, npm production audits web and mobile, Expo web export, e2e (1 154 passed, 0 failed, Chromium and WebKit), visual matrix phase-1 tier (2 093 captures, PASS), Lighthouse CI (3 URLs, 9 runs). Design gate PASS, round 3d: 0 High/Medium open (`docs/reports/design-qa/phase-1/2026-11-07-M1.9-round3.md`). Security round 11b: 0 Critical, 0 High, 0 Medium open (`docs/reports/security/phase-1.md`). Not run: install on a device or emulator (no device attached here; this APK was not installed or launched), Maestro.

## 0.2.0 — Phase 2 (2026-11-09)
Tester-facing summary of the release. **The release build is `0.2.0 (Build 4)`** (below), built from the commit that passed `verify.ps1 -Phase 2` (ed7557c). Build 3 is superseded: it predates the last QA fixes.

- **Release APK (Build 4):** `releases/android/speedclub-0.2.0-b4-lan-20261109-0543.apk` (55.8 MB), versionName 0.2.0, versionCode 4, SHA-256 `932AE22E788049E1FB6094763CAF76DEAC86F3BA428C0DFFAB390EE0087D346D`, signer `CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE` (certificate `95ef800d…f079`)
- **Release web package:** `releases/web/speedclub-web-0.2.0-20261109-0548.zip` (31.0 MB, 19 675 entries), SHA-256 `5b3fdc798bd41f063cdad49a78bef33625c7c283404ca6e97939cc7b35ef7de8`, built with `scripts/package-web.ps1` from `b9125b0` (log `docs/reports/logs/m29-package-web-0.2.0-final.log`). `web/` server code is unchanged since the dry-run package below (only tests and the bundled member web app differ), so the dry-run results apply.

Superseded Build 3 facts, kept for the record:

- APK: `releases/android/speedclub-0.2.0-b3-lan-20261108-1850.apk` (55.8 MB), versionName 0.2.0, versionCode 3, `minSdk` 24, `targetSdk` 36
- SHA-256: `D0042D262E4CD02F6909B7D7272F9675D95C2851570838114ABA0139AE1F2A5B`
- Signed by: `CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE`, certificate SHA-256 `95ef800d…f079` (the same key as 0.1.0 Build 2)
- Permissions: the 8 permissions of the SEC-P1-06 allow-list (in the build entry)
- Web package: `releases/web/speedclub-web-0.2.0-20261108-1855.zip` (31.0 MB, 19 675 entries), SHA-256 `5550765fa564f6342d7a6c284fcbd865c5bf97cc4c5849047605382b3bd69506`. Built with `scripts/package-web.ps1` from `b4994a1` (`web/` from that commit, `mobile/` clean; `b4994a1` differs from the APK tree by test files only). Dry run passed (`docs/DEPLOY.md`, dry run notes M2.9; log `docs/reports/logs/m29-dryrun-0.2.0.log`): a fresh install, the smoke test, a re-deploy update, and the first update from the 0.1.0 package to Phase 2, on a private Apache + PHP-FPM with scratch databases. The legal texts still hold `[[…]]` placeholders (10 files, 78 lines): not for a public host (OA-10)
- Built from: `6c6582f` plus the version bump to 0.2.0 / 3, which `5e4db50` commits (`mobile/version.json`, this file)

### Neu für Tester (DE)
- **Start:** Dein Feed zeigt Builds von Leuten, denen du folgst, dazu empfohlene Builds, neue Builds und beliebte Mods. Unter „Benachrichtigungen“ findest du alles nach Tagen sortiert und kannst alles als gelesen markieren. Benachrichtigungen kommen in der App, per E-Mail und, sobald Push eingerichtet ist, aufs Handy. Ruhezeiten stellst du selbst ein.
- **Entdecken:** Suche mit Filtern (Marke, Modell, Generation, Felgen, Fahrwerk, Leistung und mehr), Sortierung und Ansicht als Liste oder Raster. Neu sind Seiten für jede Marke und jedes Modell, ein Vergleich der Felgen-Setups pro Modell und „Ähnliche Builds“ unter jedem Fahrzeug.
- **Nachrichten:** Chats mit anderen Mitgliedern. Wer dir zum ersten Mal schreibt, landet bei den Anfragen; du nimmst an, löschst oder blockierst und meldest. Du kannst Fotos und Fahrzeuge teilen. Dazu gibt es Lesebestätigungen (abschaltbar), eine Tippanzeige und Reaktionen. Chats lassen sich stummschalten, archivieren und löschen.
- **Profile und Folgen:** Mitgliederprofile mit Folgen und Nachricht, Listen für Follower und „Folge ich“, gespeicherte Builds und Blockieren.
- **Einstellungen:** Konto, E-Mail und Passwort ändern, Geräte und Sitzungen, Zwei-Faktor-Schutz mit Wiederherstellungscodes, Privatsphäre (wer dir schreiben darf, Sichtbarkeit in der Suche, Lesebestätigungen), Benachrichtigungen, Sprache und Einheiten (PS, kW oder hp), Datenexport, Konto löschen, Hilfe und Kontakt.
- **Sicherheit und Melden:** Du kannst jedes Profil, Fahrzeug, Foto und jede Nachricht melden, auch ohne Konto über die Webseite (/melden). Unter „Meine Meldungen“ siehst du den Stand deiner Meldungen und Entscheidungen über deine Inhalte, jeweils mit Begründung und der Möglichkeit zum Widerspruch.
- **Extras:** QR-Aufrufe und Meilensteine für deinen Sticker, Legalitätsstatus von Mods, HU/AU-Erinnerung, Kennzeichen verpixeln, Builds vergleichen, Teilen-Karten (9:16 und 1:1) und das QR-Schild als PDF. Im Web gibt es Tastenkürzel und einen Schnellwechsel mit ⌘K.
- **Wichtig:** Diese Version ist mit dem neuen Schlüssel signiert, wie 0.1.0 Build 2. Hast du Build 2, installierst du 0.2.0 einfach darüber. Eine ältere Testversion (vor dem 8. November) deinstallierst du vorher einmal.

### What's new (EN)
- **Home:** your feed with builds from people you follow, recommended builds, new builds and popular mods. Notifications are grouped by day and can all be marked as read. They arrive in the app, by e-mail and, once push is set up, on the phone, with quiet hours you set yourself.
- **Discover:** search with filters (make, model, generation, wheels, suspension, power and more), sort, and list or grid view. New: a page for every make and model, a wheel-setup comparison per model, and "Similar builds" under every vehicle.
- **Messages:** chats with other members. A first message from someone new lands in Requests, where you accept, delete, or block and report. Share photos and vehicles; read receipts (can be switched off), typing indicator and reactions; mute, archive and delete conversations.
- **Profiles and follows:** member profiles with Follow and Message, follower and following lists, saved builds, and blocking.
- **Settings:** account, e-mail and password changes, devices and sessions, two-factor protection with recovery codes, privacy (who can message you, search visibility, read receipts), notifications, language and units (PS, kW or hp), data export, account deletion, help and contact.
- **Safety and reporting:** report any profile, vehicle, photo or message, also without an account on the website (/melden). "My reports" shows the status of your reports and of decisions about your content, each with its reasons and the option to appeal.
- **Extras:** QR scans and milestones for your sticker, legal status of mods, HU/AU (MOT) reminder, number-plate blur, compare builds, share cards (9:16 and 1:1) and the QR placard as a PDF. On the web: keyboard shortcuts and a ⌘K quick switcher.
- **Important:** this build is signed with the new key, like 0.1.0 Build 2. If you have Build 2, install 0.2.0 over it. Uninstall any older test build (from before 8 November) once first.

### Installieren (DE)
1. Dein Android-Handy (ab Android 7) muss im **selben WLAN** sein wie der Rechner, auf dem der SPEED CLUB Server läuft (`http://192.168.110.51:8080`). Diese `lan`-Version funktioniert nur dort. Ändert sich die IP-Adresse des Rechners, braucht es eine neue Version.
2. Lade die APK herunter und prüfe die Prüfsumme: Sie muss `D0042D262E4CD02F6909B7D7272F9675D95C2851570838114ABA0139AE1F2A5B` sein (macOS/Linux: `shasum -a 256 <Datei>`, Windows: `certutil -hashfile <Datei> SHA256`).
3. Öffne die Datei auf dem Handy und erlaube der App, mit der du sie öffnest (Dateien oder Browser), einmal „Unbekannte Apps installieren“.
4. Hast du 0.1.0 Build 2, wird sie aktualisiert und du bleibst angemeldet. Meldet Android „App nicht installiert“, ist noch eine ältere Testversion mit dem alten Schlüssel drauf: deinstallieren, dann neu installieren.
5. Push-Benachrichtigungen kommen in dieser Version noch nicht an. In der App und per E-Mail siehst du alles. Neue Nachrichten erscheinen nach ein paar Sekunden von selbst.

### Install notes (EN)
1. The Android phone (Android 7 or newer) must be on the **same Wi-Fi** as the machine that runs the SPEED CLUB server (`http://192.168.110.51:8080`). This `lan` build works there only. If that machine's IP address changes, a new build is needed.
2. Download the APK and check its SHA-256: `D0042D262E4CD02F6909B7D7272F9675D95C2851570838114ABA0139AE1F2A5B` (macOS/Linux `shasum -a 256 <file>`, Windows `certutil -hashfile <file> SHA256`).
3. Open the file on the phone and allow the app you open it with (Files or the browser) to "install unknown apps", once.
4. Over 0.1.0 Build 2 it installs as an update and you stay signed in. If Android says "App not installed", an older test build signed with the retired key is still on the phone: uninstall it, then install again.
5. Push notifications do not arrive in this build (no Expo/FCM project yet, OA-14). In-app notifications, tab badges and e-mail work. New messages appear by polling (3 s in an open conversation, 15 s in the inbox) without Pusher (OA-13).
6. For the operator: the machine's firewall must let the phone reach port 8080, and the services must run (`sh scripts/services.sh start`).

### App-config note
`latest_version` stays **0.1.0** in the seed (`ConfigSeeder`, `FIRST_VERSION`); no code was changed for this release. Staff publish 0.2.0 through the admin's app-config publish flow once 0.2.0 has been handed out (the brief names ADM-36; in `docs/04_SCREEN_REGISTER.md` the min/latest versions sit in ADM-37 Remote config, and ADM-36 is Feature flags. Both are Phase 3 admin screens, so that publish step only exists after Phase 3). The app reads only `min_version` (SYS-01 force update). A `latest_version` of 0.1.0 therefore changes nothing a 0.2.0 tester sees. The web dry run printed the seeded value (`{"ios":"0.1.0","android":"0.1.0"}`, see the web package line above).

### iOS
`mobile/eas.json` has the profiles `development` (dev client, simulator), `preview` (`EXPO_PUBLIC_APP_ENV=staging`; iOS `distribution: store`, so the build can go to TestFlight; Android internal APK) and `production` (store), with `appVersionSource: local` and `requireCommit: true`. `npx expo config --type introspect` with `EXPO_PUBLIC_APP_ENV=staging` (run 2026-11-08 on `b4994a1`) resolves to `version` 0.2.0, `ios.buildNumber` "3" (`CFBundleShortVersionString` 0.2.0, `CFBundleVersion` 3, both from `mobile/version.json`), bundle id `de.speedclub.app`, `aps-environment = production`, App Transport Security HTTPS only, `ITSAppUsesNonExemptEncryption` false. No `eas` command was run. TestFlight is **owner action OA-15** (Apple Developer account and Team ID, `eas login`, App Store Connect record, then `docs/IOS_TESTFLIGHT.md`). A real preview build also needs the staging host (OA-11, OA-12) and, for push, OA-14.

### Owner actions for this release
- OA-1 keystore back-up · OA-9 Maestro (native smoke, BUG-1) · OA-10 legal texts before any public seed · OA-11/OA-12 staging host and URL · OA-13 Pusher · OA-14 Expo project + FCM (push) · OA-15 Apple Developer + EAS for TestFlight (`docs/IOS_TESTFLIGHT.md`) · OA-16 SMTP · OA-17 lawyer wording.

### Release checklist (M2.9), status at 2026-11-09 05:50
1. Gates: **met.** `verify.ps1 -Phase 2` exit 0, 12/12 PASS on ed7557c (`docs/reports/phase-2/verify-20261109-045319.md`); design gate PASS (round 5 + addenda); security 0 Critical/High. Build 4 is built from that commit. *Earlier note, 2026-11-08 19:20 (Build 3): not met at the time.* `verify.ps1 -Phase 2` has not run on the release commit (there is no Phase 2 verify report yet). The design gate was FAIL in round 4 (1 Medium, DQ-457); its fixes are in `6c6582f`, and the re-capture was still running. Security: 0 High (round 2, PASS). See Test status in the build entry.
2. Version: 0.2.0 / versionCode 3, committed in `5e4db50`. Done.
3. `build-apk.ps1 -Target lan -VersionName 0.2.0 -Clean`. Done (`docs/reports/logs/m29-apk-0.2.0.log`).
4. SEC-P1-06: the script's `aapt dump permissions` check passed, and the release engineer read the logged list. It holds exactly the 8 allowed permissions. Done.
5. Signer: `apksigner verify --print-certs`, re-run by the release engineer, shows `CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE` with certificate SHA-256 `95ef800df2d5d92b0f8ca9c9ded0b71bf96b0b82389284b21e8e24863002f079`. `shasum -a 256` of the APK equals its `.sha256` file. Done.
6. Emulator: none was running and `adb devices` listed no device, so `adb install`, the launch, `nav-hardware-back.yaml` and the Maestro smoke were **not run** (OA-9).
7. Web package after the APK (clean `mobile/`), then the DEPLOY dry run including the Phase 2 steps. Done, passed (see the web package line above).
8. Build entry completed below.

## 0.2.0 (Build 3) - lan - 2026-11-08 18:54
- APK: releases/android/speedclub-0.2.0-b3-lan-20261108-1850.apk (55.8 MB)
- SHA-256: D0042D262E4CD02F6909B7D7272F9675D95C2851570838114ABA0139AE1F2A5B
- Signed by: CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE (certificate SHA-256 95ef800df2d5d92b0f8ca9c9ded0b71bf96b0b82389284b21e8e24863002f079)
- API: http://192.168.110.51:8080
- Permissions (aapt dump permissions, SEC-P1-06 allow-list passed): android.permission.ACCESS_NETWORK_STATE, android.permission.ACCESS_WIFI_STATE, android.permission.INTERNET, android.permission.POST_NOTIFICATIONS, android.permission.VIBRATE, android.permission.WAKE_LOCK, com.google.android.c2dm.permission.RECEIVE, de.speedclub.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
- Built from: `6c6582f` plus the version bump to 0.2.0 / 3 (committed afterwards in `5e4db50`, together with this entry). `b4994a1` came after the APK and changes test harness files only (`web/tests/e2e/visual`).
- Changes (since 0.1.0 Build 2, `phase-1..5e4db50`, 76 commits, 17 of them e2e-only):
  - M2.0: Phase 2 pre-flight, baseline green, backlog triage (`698ddcf`); API contracts for M2.2–M2.7 (`dba259b`).
  - M2.1 Social graph: follow lists, member profile PROF-02, connections PROF-04, blocks everywhere and SET-08, saved builds PROF-05 (`7e5d5dd`). Review and design fixes in `a4495b0`, `d181088` and `6759e2f`.
  - M2.2 Home and notifications: the full HOME-01 feed with ranking, HOME-02, the notification service, Expo push tokens, the AUTH-10 primer, digests and quiet hours (`0690ec5`). Fixes in `d181088`, `6e8542e`, `2223cee` and `3f8ca2b`.
  - M2.3 Discover: DISC-01–04 with facets, filters, sort, list/grid, make and model pages, the wheel-setup table and similar builds (`452a29b`, `6eb7184`, `ca96a0a`). Fixes in `22b17e8` and `3ce5a6d`.
  - M2.4 Messaging: MSG-01–05 with requests, polling and the Pusher path, photo and vehicle messages, push, typing, read receipts, reactions, mute and archive (`40121c4`, `6fecf59`). Server in `6bb2dc7`. Fixes in `4caa37b` and `7b2f326` (private chat photos).
  - M2.5 Settings: SET-01–16 to FS-12, sessions, two-factor protection and AUTH-11, privacy, notification preferences, language and units, export, deletion (SET-13 and WEB-05), help and contact (WEB-10) (`4f65d90`, `eb0b71c`, `c01af0a`, `9655752`). Server in `6bb2dc7`.
  - M2.6 Safety: report flow on every target, WEB-09, Blockieren & melden, cases, decisions and appeals, SAFE-01 and SET-16 (`a2748d5`, `aa6f04a`). Server in `6bb2dc7`.
  - M2.7 System and signature: SYS-01/02, WEB-04, WEB-07, VEH-06 compare, VEH-07 share cards, placard PDF, QR stats, legal status of mods (ADR-153 lifted), plate blur, HU/AU, web shortcuts and ⌘K (`2085ceb`, `fb58b99`). Server in `6bb2dc7`.
  - M2.8 Phase QA: copy reviews (`12fa32f`, `fe6b863`). Security: reset codes only over the https link (`7e54554`), SEC-P2-01…05 and the carried Phase 1 items, Discover at 2,000 builds (`699678d`). Polish: legal-status pill, recent chats in ⌘K, date-only deadlines (`5e4604d`). e2e and design rounds 1–4: `e7fb315`, `3168c4f`, `4fc279d`, `8425541`, `88d7074`, `b83fcf0`, `b3d7b38`, `5c55013`, `2ec06c2`, `6c6582f`. ADR-189 to ADR-211.
  - M2.9 prep: signer pin and permission gate in `build-apk.ps1`, EAS and iOS config, deploy docs (`723d3a5`). Then this build (`5e4db50`).
- Known issues (Low):
  - **Native runs were not done.** Maestro is not installed (owner action OA-9), and no emulator or device was attached for this build. So **BUG-1** (Android 13–15 hardware back; fix ADR-117) is **still unverified on a device**: `mobile/e2e/maestro/nav-hardware-back.yaml` must run on this APK. Also not run on a device: native auth (BL-9, Jest only), Android App Link verification for the reset link (SEC-P2-03), the wheel table's native sticky column, and pusher-js after a reconnect.
  - Design: round 4 (`docs/reports/design-qa/phase-2/2026-11-08-M2.8-round4.md`) left 1 Medium (DQ-457, raw platform names on SET-06) and 5 Lows open (DQ-452, 454, 455, 456, 458). `6c6582f` fixes DQ-457, 458, 456, 452 and 454 and is in this APK, but design-qa had not re-captured those cells at the time of this entry. DQ-455 (DISC-02 desktop: the count on the selected generation chip appears late) stays open; `b4994a1` only makes the capture wait for it. Carried: DQ-299, 302 and 303. DQ-274 is moved to Phase 3.
  - Security (`docs/reports/security/phase-2.md`, round 2): no Critical, High, Medium or Low open among the Phase 2 findings. 8 Info stay open (SEC-P2-07 to -14). Carried from Phase 1: SEC-P1-53 (Low, one session row per anonymous `/sanctum/csrf-cookie`) and SEC-P1-11 (Info).
  - `lan` target: cleartext HTTP to the LAN address by design. Not for testers outside the local network. A staging APK needs OA-11/OA-12.
  - No push without OA-14, and polling instead of realtime without OA-13 (3 s / 15 s). Both are the designed fallbacks.
  - The signature features are switched on by the seed on every environment except `production` (`FeatureFlagSeeder`). On a production seed they start off until staff turn them on (Phase 3 admin).
  - App-config `latest_version` is 0.1.0 (see the app-config note above). It has no visible effect.
- Test status (only what ran; there is **no `verify.ps1 -Phase 2` report** for this commit):
  - Mobile verify on `6c6582f` (the APK's app code): tsc, eslint, Jest 203 suites / 2 626 tests passed, i18n gate passed (`docs/reports/logs/m28-lead-r4-verify.log`).
  - Laravel server gate (M2.8 round 2): pint, PHPStan, Pest 4 832 tests passed, perf 16 passed, exit 0 (`docs/reports/logs/m28-server-gate2-124318.log`, run at 12:43, just before `e7fb315` was committed). After it, only `4fc279d` changes non-test files in `web/`: language strings, the WEB-04 Blade view and a demo seeder. Not re-run on the release commit.
  - Full e2e on `a186f55` (Chromium and WebKit): 1 721 passed, **19 failed** (`docs/reports/logs/m28-te-e2e-full-a186f55.log`). Later targeted runs: axe and shell on `2ec06c2`, 895 passed (`m28-te-2ec06c2-axe.log`). The test engineer's runs on `6c6582f` were still in progress when this entry was written. No green full e2e exists for the release commit yet.
  - Visual phase-2 tier on `a186f55`: 3 699 cells, reviewed in design round 4 (verdict FAIL, see Known issues).
  - Security round 2: PASS (0 Critical/High/Medium/Low among the Phase 2 findings).
  - APK: the script's checks (signer pin, permission allow-list) passed. Re-checked by the release engineer: `shasum -a 256` equals the `.sha256` file; `apksigner verify --print-certs` shows the SPEED CLUB certificate `95ef800d…f079`; `aapt dump badging` shows `de.speedclub.app`, versionCode 3, versionName 0.2.0.
  - Not run: install and launch on a device or emulator (`adb devices` listed none), Maestro, Lighthouse CI on the release commit.

## 0.2.0 (Build 4) - lan - 2026-11-09 05:48
- APK: releases/android/speedclub-0.2.0-b4-lan-20261109-0543.apk (55.8 MB)
- SHA-256: 932AE22E788049E1FB6094763CAF76DEAC86F3BA428C0DFFAB390EE0087D346D
- Signed by: CN=SPEED CLUB, OU=Mobile, O=SPEED CLUB, L=Berlin, ST=Berlin, C=DE (certificate SHA-256 95ef800df2d5d92b0f8ca9c9ded0b71bf96b0b82389284b21e8e24863002f079)
- API: http://192.168.110.51:8080
- Permissions (aapt dump permissions, SEC-P1-06 allow-list passed): android.permission.ACCESS_NETWORK_STATE, android.permission.ACCESS_WIFI_STATE, android.permission.INTERNET, android.permission.POST_NOTIFICATIONS, android.permission.VIBRATE, android.permission.WAKE_LOCK, com.google.android.c2dm.permission.RECEIVE, de.speedclub.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
- Built from: ed7557c (the verified commit) plus the version bump to 0.2.0 / 4 (b9125b0)
- Changes since Build 3: the last M2.8 QA fixes. App: designed QR-02 zero-scan state (DQ-459/460), SET-06 platform names and meta (DQ-457/458), SET-16 and wheel name breaks (DQ-452/456), dialog overflow rule (DQ-454), word boundary as a plain character (filter chip label in name), overlays that never opened because the layout moved under the pointer (sticky bar height from the first frame, thread skeleton at full height), the `#email=`/`#code=` re-render loop (React #185), hidden web tab panes below the shown one (WebKit wheel). Test harness only otherwise
- Known issues (Low): DQ-461 (QR milestone number/unit split at 200 % font); code-review nits 4, 5, 10, 12; security Info SEC-P2-07 to -14 and SEC-P1-53 (Low); Maestro/native smoke not run (OA-9), BUG-1 unverified on a device; lan target only, no push/realtime credentials
- Test status (`docs/reports/phase-2/verify-20261109-045319.md`, commit ed7557c, mode full): all 12 gates PASS: design tokens, custom icons, mobile verify (2 630 Jest tests), Laravel verify (4 838 Pest tests), Laravel perf probes (16), web assets verify, npm production audits web and mobile, Expo web export, e2e (1 755 passed, 0 failed, Chromium and WebKit), visual matrix phase-2 tier (154 routes, 3 699 captures, all matching the approved baselines, 0 High/Medium), Lighthouse CI (3 URLs). The APK itself was built, signed and checked by the script (signer, permissions, SHA-256); not installed on a device