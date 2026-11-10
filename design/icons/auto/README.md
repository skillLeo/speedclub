# Custom automotive icons (16)

256 × 256 viewBox, 16-unit stroke, round caps and joins, optical size matching Phosphor "regular", drawn inside Phosphor's live area (24 to 232). Every glyph has a `-fill` variant following Phosphor's fill convention: solid silhouette, detail knocked out with `fill-rule="evenodd"`, same outer bounds as the regular version.
Files: wheel, tyre, coilover, air-suspension, exhaust, turbo, intake, engine, ecu-chip, brake-disc, wing, seat, light, audio, gearbox, drivetrain (`<name>.svg`, `<name>-fill.svg`).

Allowed in a source: `path`, `circle`, `rect`, `line`, `polyline` with geometry attributes only. No groups, transforms, ids, styles, text or colours; paint lives on the root `<svg>`. For a solid dot in a regular glyph use a small circle (`r="4"` gives a dot of radius 12 from the stroke alone).

`npm --prefix design run icons` validates the sources and generates React Native components (`mobile/src/ui/icons/auto/`), Vue components (`web/resources/js/shared/icons/auto/`) and a Blade sprite (`web/resources/views/components/icons/auto-sprite.blade.php`). `node design/scripts/build-icons.mjs --check` fails on a rule break (exit 1) or stale outputs (exit 2). Never edit generated files.
