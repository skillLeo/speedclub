# Maestro smoke flows (Android)

Flows run against an installed signed release APK (`de.speedclub.app`) on the dedicated emulator.

## Warning: a real phone may be attached

The owner's phone can be connected over wireless adb. **Never address it.** Every adb command uses
`-s emulator-5554` and every Maestro command uses `--device emulator-5554`. Without these flags a
command can reach the phone. Other projects have AVDs on this PC too: use only `SpeedClub_Pixel`.

## Start the emulator

Run this in the background, it does not return (Git Bash, from anywhere):

```sh
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd SpeedClub_Pixel -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot
```

Wait for boot, then install the APK. It must be an `x86_64` build (`build-apk.ps1 -Abis`):

```sh
adb -s emulator-5554 shell getprop sys.boot_completed   # 1 when ready
adb -s emulator-5554 install -r releases/android/<apk>
adb -s emulator-5554 shell settings put global hide_error_dialogs 1
```

The last line stops "Process system isn't responding" dialogs from covering the app while the
emulator is busy just after boot. App crashes and ANRs are still in logcat, so check it after a run:

```sh
adb -s emulator-5554 logcat -d | grep -E "FATAL|ANR in de\.speedclub"
```

## Run

```sh
export JAVA_HOME="C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot"
maestro --device emulator-5554 test --test-output-dir <dir> mobile/e2e/maestro/nav-shared-routes.yaml
```

Maestro is at `%USERPROFILE%\.maestro\maestro\bin\maestro.bat`. `--device` goes before `test`.
`--test-output-dir` collects screenshots and debug output; keep it outside the repo.

When finished: `adb -s emulator-5554 emu kill`.

## Flows

| Flow | Covers | Status on build 0.1.0-b1 (Android 14) |
|---|---|---|
| `nav-shared-routes.yaml` | ADR-101: shared route stays in its tab, per-tab stack, in-app back, re-tap pops to root. Since M1.6 on the real screens as lukas.sc (VEH-01 from Profile, QR-02 from Garage); pass `-e DEMO_MEMBER_PASSWORD=…` | passed 3/3 on the M1.3 spike; the M1.6 version not run yet (no APK) |
| `nav-hardware-back.yaml` | Hardware back pops within the tab (guest: Profile → SET-01 → back) | **failed on 0.1.0-b1: the app left to the launcher.** `predictiveBackGestureEnabled: true` in `app.config.ts` stopped `onBackPressed` on Android 13 to 15; the flag is false since (BUG-1), re-run on the next APK |
| `f1-onboarding.yaml` | F1 from Welcome to the garage, killed and resumed twice | not run yet |
| `f2-add-vehicle.yaml` | F2: F1's new account → wizard with a gallery photo → GAR-04 → GAR-09 | not run yet (check the Photo Picker id on the first run) |
| `f4-scan.yaml` | F4: `speedclub://c/<code>` for the active and the three WEB-06 codes, then the sticker URL in Chrome | not run yet |

A failing flow stays red until the app is fixed. Do not remove or relax its assertions.

## Add a flow

1. Add `<name>.yaml` here with `appId: de.speedclub.app`, starting from `launchApp` with
   `clearState: true` and `stopApp: true`, then `extendedWaitUntil` on the first screen (allow 60 s,
   the emulator is slow on a cold start).
2. Select by `id`. React Native exposes `testID` as the resource id without a package prefix, so
   `testID="tab.home"` is `id: tab.home`. Inspect with `maestro --device emulator-5554 hierarchy`.
3. Assert state as well as presence: `selected: true` reads `aria-selected`, and `text:` is a regex
   over the whole string, so escape parentheses (`'.*\(discover\).*'`).
4. Use `assertNotVisible` where a hidden screen could match the same id (shared routes exist per tab).
5. Run it three times before committing. Never add fixed sleeps; use `extendedWaitUntil`.
