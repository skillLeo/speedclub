# SPEED CLUB — iOS preview build and TestFlight (owner steps)

> Prepared in M2.9 (2026-11-08), checked again for version 1.0.0 in M3.9 (2026-11-09). **Not run yet:** there are no Apple or Expo credentials on the dev Mac, so no `eas` command has been run against this configuration. HANDOFF owner action **OA-15** (together with OA-11, OA-12 and OA-14).
> Sources (checked 2026-11-08): docs.expo.dev `eas/json`, `build-reference/app-versions`, `eas/environment-variables` (+ `usage`, `manage`), `submit/ios`, `build-reference/ios-capabilities`, `guides/localization`, and the installed Expo SDK 58.0.22 config types.
> **M3.9 check (2026-11-09):** `npx expo config --type public` with `EXPO_PUBLIC_APP_ENV=production` (dummy `EXPO_PUBLIC_WEB_URL` and `EAS_PROJECT_ID`) resolves bundle id `de.speedclub.app`, `supportsTablet: false`, `associatedDomains: [applinks:<host>]`, App Transport Security HTTPS-only, `CFBundleLocalizations [de, en]`, `extra.eas.projectId` from the environment, `version` and `buildNumber` from `mobile/version.json` (today `0.2.0` / `4`). `mobile/eas.json` needs no change for TestFlight: `preview` (staging backend) and `production` (live backend) both build with `distribution: store`. The only change for 1.0.0 is the version (see "Release 1.0.0" below). Store listing, App Privacy answers and review notes: `docs/STORE_READINESS.md`.
## What is prepared in the repo

| Item | Where | Value |
|---|---|---|
| Bundle id | `mobile/app.config.ts` `ios.bundleIdentifier` | `de.speedclub.app` (ADR-038) |
| Version / build number | `mobile/version.json` → `ios.buildNumber` | `versionName` / `versionCode`, the same numbers as the Android APK of the release (`cli.appVersionSource: "local"`) |
| iPhone only | `ios.supportsTablet` | `false` |
| Export compliance | `ios.config.usesNonExemptEncryption` | `false` → `ITSAppUsesNonExemptEncryption = NO`: App Store Connect does not ask per build |
| Photo library purpose string | `expo-image-picker` `photosPermission` (Info.plist, German) and `locales.de` / `locales.en` → `InfoPlist.strings` | DE: "SPEED CLUB nutzt deine Fotos, damit du Bilder für dein Profil, deine Fahrzeuge und deine Nachrichten auswählen kannst." EN: "SPEED CLUB uses your photos so you can choose pictures for your profile, your vehicles and your messages." Camera and microphone are not requested |
| Languages | `ios.infoPlist` | `CFBundleAllowMixedLocalizations = YES`, `CFBundleLocalizations = [de, en]` |
| HTTPS only | `ios.infoPlist.NSAppTransportSecurity` (staging, production) | `NSAllowsArbitraryLoads = NO`, `NSAllowsLocalNetworking = NO` |
| Universal links | `ios.associatedDomains` (staging, production, from `EXPO_PUBLIC_WEB_URL`) | `applinks:<host>`; the paths `/v/*`, `/u/*`, `/c/*`, `/C/*` come from the server's `/.well-known/apple-app-site-association` (`PlatformFilesController::APP_PATHS`), which needs `IOS_TEAM_ID` in the host `.env` |
| Push | `expo-notifications` plugin, `mode` | `aps-environment = production` for staging and production builds (TestFlight and App Store use the production APNs); `development` only for local/lan |
| EAS profiles | `mobile/eas.json` | `development` (dev client, simulator), **`preview`** (`EXPO_PUBLIC_APP_ENV=staging`, EAS environment `preview`; iOS `distribution: store` = uploadable to TestFlight, Android internal APK), `production` (store: iOS App Store, Android AAB). `cli.requireCommit: true`: EAS builds from a clean clone of the last commit, so no uncommitted file and no `.env` ever leaves the Mac |

Checked with `npx expo config --type introspect` (EXPO_PUBLIC_APP_ENV=staging, EXPO_PUBLIC_WEB_URL=https://staging.example.de): entitlements `aps-environment = production` and `com.apple.developer.associated-domains = [applinks:staging.example.de]`; Info.plist as in the table. The Android part of the introspected config is byte-identical to the one before these changes.

## Before you start (needs to exist first)

1. **Staging host live with HTTPS** (OA-11) and its URL (OA-12). iOS release builds talk HTTPS only; a LAN address does not work.
2. **Apple Developer Program** membership (paid, yearly) for the company that publishes SPEED CLUB. Note the **Team ID** (developer.apple.com → Account → Membership details).
3. **Expo account** (expo.dev, free plan is enough for preview builds; builds queue longer).
4. Optional for push on iOS: OA-14 (Expo project, `PUSH_ENABLED=true` on the host). EAS creates the APNs key in step 6.

## Owner steps (on the Mac, in Terminal)

1. **Let git read the repo** (the copied repo belongs to root; EAS CLI runs git, and `requireCommit` needs it):
   ```
   git config --global --add safe.directory /Applications/XAMPP/htdocs/speedclub
   ```
2. **Install EAS CLI and sign in:**
   ```
   npm install --global eas-cli
   eas login
   ```
3. **Create the Expo project** (from `mobile/`):
   ```
   cd /Applications/XAMPP/htdocs/speedclub/mobile
   eas init
   ```
   `app.config.ts` is dynamic, so `eas init` cannot write the id itself: it prints the project id. Store it where both the CLI and the build server read it:
   ```
   echo 'export EAS_PROJECT_ID=<project id>' >> ~/.zshrc && source ~/.zshrc
   eas env:set --name EAS_PROJECT_ID --value <project id> --environment preview --visibility plaintext
   eas env:set --name EAS_PROJECT_ID --value <project id> --environment production --visibility plaintext
   ```
   (`app.config.ts` puts it into `extra.eas.projectId`. The id is not a secret; the lead may also commit it later.)
4. **Staging addresses for the preview build** (plain text: `EXPO_PUBLIC_*` values end up in the app anyway):
   ```
   eas env:set --name EXPO_PUBLIC_API_URL --value https://staging.<domain> --environment preview --visibility plaintext
   eas env:set --name EXPO_PUBLIC_WEB_URL --value https://staging.<domain> --environment preview --visibility plaintext
   # optional, with OA-13 (realtime): the public Pusher key and cluster
   eas env:set --name EXPO_PUBLIC_PUSHER_KEY --value <key> --environment preview --visibility plaintext
   eas env:set --name EXPO_PUBLIC_PUSHER_CLUSTER --value eu --environment preview --visibility plaintext
   eas env:list --environment preview
   ```
5. **App Store Connect record** (appstoreconnect.apple.com → Apps → "+" → New App): platform iOS, name "SPEED CLUB", primary language **German**, bundle id `de.speedclub.app` (if it is not in the list, register it under developer.apple.com → Identifiers, or let step 6 register it and come back), SKU for example `speedclub-ios`, access "Full". Then App Information → **Apple ID** (a number): that is the `ascAppId`. Give it to the lead to put into `mobile/eas.json` → `submit.preview.ios.ascAppId` (only needed for non-interactive submits).
6. **Build** (cloud; about 15–30 minutes, plus the queue):
   ```
   cd /Applications/XAMPP/htdocs/speedclub/mobile
   eas build --platform ios --profile preview
   ```
   Answer the prompts: sign in with the Apple ID of the developer account, **let EAS create** the distribution certificate and the provisioning profile, and answer **yes** to setting up push notifications (APNs key). EAS turns on the capabilities it finds in the entitlements (Push Notifications, Associated Domains) for `de.speedclub.app`.
7. **Upload to TestFlight:**
   ```
   eas submit --platform ios --profile preview --latest
   ```
   (or once: `eas build --platform ios --profile preview --auto-submit`). Apple processes the build in about 10–15 minutes; then it appears under TestFlight.
8. **Testers** (App Store Connect → the app → TestFlight):
   - **Internal testing:** create a group, add people who are users of your App Store Connect team (up to 100). No review; they get the invitation mail.
   - **External testing** (anyone with an e-mail address): needs "Test Information" (feedback e-mail, contact, what to test) and a Beta App Review of the first build. Apple asks for a sign-in: give a real tester account on the staging host (there are no demo accounts on staging, DEPLOY §7).
   - Testers install the **TestFlight** app, accept the invitation, install SPEED CLUB. A build expires after 90 days.
9. **Universal links on the host:** set `IOS_TEAM_ID=<Team ID>` (and keep `IOS_BUNDLE_ID=de.speedclub.app`) in the staging `.env`, then `php artisan config:cache`. Check: `curl https://staging.<domain>/.well-known/apple-app-site-association` lists `"<Team ID>.de.speedclub.app"` and the four paths. Apple's CDN caches this file, so a fix can take a while to reach phones.
10. **Push on iOS** (with OA-14): the APNs key from step 6 is stored with your Expo project; nothing else is needed on the host than `PUSH_ENABLED=true`.

## Next builds

- iOS uses the **build number of the matching Android APK** (`mobile/version.json` `versionCode`, `appVersionSource: local`). Build iOS right after `build-apk.ps1` has bumped and the lead has committed it. TestFlight refuses a build number it already has for that version: for a second iOS build of the same release, the lead bumps `versionCode` by 1 and commits first.
- `eas build` refuses to start with uncommitted changes (`requireCommit`): build from a committed state only.
- Check the resolved configuration without building: `eas config --platform ios --profile preview`.
- Android through EAS (fallback when local Gradle is blocked, ADR-026): `eas build --platform android --profile preview`. **Caution:** on the first Android EAS build, EAS offers to generate a keystore. A generated key is a new app identity: testers would have to uninstall, and `ANDROID_CERT_SHA256` on the host must list it. Use the existing upload key only after the owner decides to upload it to Expo (OA-1 back-up first).

## Release 1.0.0 to TestFlight (production profile)

The store release is `versionName` **1.0.0** (`docs/07_QA_AND_RELEASE.md` §7). The steps differ from the preview build only in the profile and the backend:

1. **Lead (dev Mac):** set `mobile/version.json` to `"versionName": "1.0.0"` and the next `versionCode` (it is the iOS build number as well; the Android APK of the same release uses the same number), commit. EAS refuses uncommitted changes (`requireCommit`).
2. **Owner:** the production host is live with HTTPS (`docs/DEPLOY.md`), `IOS_TEAM_ID` is set there and `/.well-known/apple-app-site-association` lists `<Team ID>.de.speedclub.app`.
3. **Owner:** EAS environment `production` (plain text):
   ```
   eas env:set --name EXPO_PUBLIC_API_URL --value https://<domain> --environment production --visibility plaintext
   eas env:set --name EXPO_PUBLIC_WEB_URL --value https://<domain> --environment production --visibility plaintext
   eas env:set --name EXPO_PUBLIC_PUSHER_KEY --value <key> --environment production --visibility plaintext   # with OA-13
   eas env:set --name EXPO_PUBLIC_PUSHER_CLUSTER --value eu --environment production --visibility plaintext
   eas config --platform ios --profile production    # check: version 1.0.0, build number, applinks:<domain>
   ```
4. **Owner:** `eas build --platform ios --profile production`, then `eas submit --platform ios --profile production --latest`. The build appears in App Store Connect → TestFlight after Apple's processing; internal testers get it at once, external testers after Beta App Review.
5. **Owner:** the App Store version page (screenshots, description, App Privacy, age rating, review notes with a demo account) is filled from `docs/STORE_READINESS.md`; then "Submit for Review" with this build.

Things to watch on the first upload (not verifiable without an Apple account):
- **Privacy manifest:** Expo SDK 58 packages ship their own `PrivacyInfo.xcprivacy`; if App Store Connect mails an `ITMS-91053` warning ("Missing API declaration"), the lead adds the named API categories and reasons under `ios.privacyManifests` in `mobile/app.config.ts` and builds again.
- **Push entitlement:** `aps-environment = production` for staging and production profiles; EAS must have created the APNs key (step 6 above) or push stays off on iOS.
- **Export compliance:** answered by `ITSAppUsesNonExemptEncryption = NO`; App Store Connect should not ask.

## Not covered here

- App Store listing (screenshots, description, App Privacy questionnaire, age rating, review notes): `docs/STORE_READINESS.md`.
- Sign in with Apple is not offered (no third-party sign-in exists), so it is not required (Guideline 4.8).
