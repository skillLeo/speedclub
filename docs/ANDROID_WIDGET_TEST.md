# Android widget "Mein Auto": manual test (M4.18 → M4.19)

The widget (09 §8.14, ADR-454; `react-native-android-widget@0.26.0`) was built without a native build. Jest covers the data writer
and reader, the photo cut, the sync and both render trees (`mobile/tests/widget/*`). Everything below needs the AVD and a release
build, so the release engineer does it once, in M4.19, on the Android 16 arm64 AVD (`el36`) with the lan APK.

Code: `mobile/src/features/widget/*`, entry `mobile/index.ts`, config plugin entry in `mobile/app.config.ts`, assets in
`mobile/assets/widget/` (built by `design/scripts/build-widget-assets.mjs`).

## Before you start
- [ ] The flag `android_widget` exists and is on for local/lan (09 §8.18: on · on · off). Without it the app keeps the widget empty.
      Lane B / the lead adds it to `FeatureFlagSeeder::ON_OUTSIDE_PRODUCTION` and `feature_flags.json`; for a quick check, a QA
      build can force it (`qaFlags=android_widget`).
- [ ] `expo prebuild` output contains `android/app/src/main/res/xml/widgetprovider_meinauto.xml` with
      `minWidth 250dp`, `minHeight 110dp`, `targetCellWidth 4`, `targetCellHeight 2`, `resizeMode horizontal|vertical`,
      `updatePeriodMillis 21600000`, `previewImage @drawable/meinauto_preview`; the manifest has the receiver `.widget.MeinAuto`
      (exported false) and `RNWidgetCollectionService`; `assets/fonts/` holds `Inter-Medium`, `Inter-SemiBold`,
      `ArchivoSemiExpanded-SemiBold`.
- [ ] The release build (minify + shrink resources) starts, and the widget picker lists it (no R8 removal of the provider).

## Picker and placement
- [ ] The widget picker shows "Mein Auto" under SPEED CLUB with the preview (blue R34, "Beispiel" badge) and 4 × 2 as default size.
- [ ] Signed out: placing it shows the empty state: the black 911 photo, "Dein Auto und seine nächste Fälligkeit." and
      "Auto hinzufügen". No crash, no ANR dialog, logcat clean of `ReactNativeJS` errors.
- [ ] Tapping the empty widget opens the app; signed out, it asks to sign in and then lands in the wizard (`/add-vehicle/new/vehicle`).

## Data (the app pushes)
- [ ] Sign in as `lukas.sc@speedclub.test` (main car: Nissan Skyline GT-R R34). Within a few seconds, without opening the garage,
      the widget shows the R34 photo (4:5 crop, car centred), "NISSAN", "Skyline GT-R R34" in Archivo SemiExpanded, and the next
      due item (label in caps, countdown below; overdue in red, due within 30 days in the warning tone).
- [ ] The photo is a file: `adb shell run-as de.speedclub.app ls files/widget` lists `mein-auto.json` and one `car-<media>-<w>.jpg`.
      `mein-auto.json` holds no token, no e-mail and no https URL other than the variant it was cut from.
- [ ] Airplane mode, then force a widget refresh (resize it): it still shows the photo (no network needed).
- [ ] Change the main car in GAR-01 (or the cover in GAR-07), go back to the garage: the widget follows; the old `car-*.jpg` is gone.
- [ ] Add or edit a maintenance item (MNT-02) so it becomes the car's next one: the widget's due line follows.
- [ ] Nothing due in 60 days for the main car: "60 Tage nichts fällig" (M4.19: shortened, it was cut at 4 × 2).
- [ ] Tap the widget: the app opens GAR-02 of that car (`speedclub://garage/<id>`): cold (after `am force-stop`), warm, and
      task restore (task in recents, process killed with `adb shell am kill de.speedclub.app`; M4.19 fix
      `mobile/plugins/withNewIntentAsIntent.js`: MainActivity keeps the newest intent so the initial URL is the widget's).
- [ ] Sign out: the widget turns to the empty state at once, and `files/widget` is empty. Sign in as another member
      (`kenji.r34@speedclub.test`): his main car (R35) appears, never Lukas's.
- [ ] Language English in SET-11: the next update shows "in 43 days" / "Nothing due for 60 days".

## Layout, themes, accessibility
- [ ] System dark mode on/off: the panel switches between Carbon surface and Hell surface; the photo pane is unchanged.
- [ ] Layout (M4.19, `layout.ts` fits by width too): shown text is never cut while another arrangement fits. Given up in this order:
      the make, the due label's own line (it joins the countdown), photo width (42 → 34 → 26 % → no photo), the name's full
      length, the due line. Resize to 250 × 110 dp (smallest): no make, the photo narrows, "HU/AU in 43 Tagen" on one line.
- [ ] System font size largest (200 %): the name grows to 1.3×, the due item to 2×; at 4 × 2 on a 360 dp phone the photo gives
      way so "Skyline GT-R R34" and the due item show in full; at 250 × 110 only the name fits, the due line is left out, not cut.
- [ ] TalkBack on the widget reads "Mein Auto: NISSAN Skyline GT-R R34. HU/AU in 43 Tagen. Öffnet dein Auto in der Garage." (empty:
      "Mein Auto: noch kein Auto. Auto hinzufügen.").
- [ ] Corners: the photo is clipped to the widget's 20 dp corners; no square photo edge on the launcher's rounded background.

## Stability
- [ ] Leave the widget for one `updatePeriodMillis` cycle (or `adb shell cmd appwidget …`/reboot): it redraws from the stored file;
      the countdown moved on by the days passed. No ANR (upstream issue #165) in `adb logcat | grep -i anr`.
- [ ] Kill the app, then reboot the AVD: the widget redraws (headless task) without opening the app.
- [ ] Remove the widget: no crash; place it again: it draws at once from the stored snapshot.

Record the result and screenshots (light, dark, smallest size, 200 %, empty) in `docs/reports/phase-4/m4.19-native/`.
