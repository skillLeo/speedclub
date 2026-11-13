# SPEED CLUB auto glyph set 2.0 (49)

256 × 256 viewBox, 16-unit stroke, round caps and joins, optical size matching Phosphor "regular", drawn inside Phosphor's live area (24 to 232). Every glyph has a `-fill` variant following Phosphor's fill convention: solid silhouette, detail knocked out with `fill-rule="evenodd"`, same outer bounds as the regular version.
Glyph set 2.0 (docs/09 §4.5, Appendix C) extends the v1 sixteen, which keep their names and their `-fill` variants:

- **Systems (build sheet):** v1 wheel, tyre, coilover (suspension), air-suspension, exhaust, turbo, intake, engine, ecu-chip (ECU tune), brake-disc, wing (aero wing), seat, light (lighting), audio, gearbox, drivetrain; 2.0 supercharger, intercooler, fuel, cooling, oil, brake-caliper, splitter-diffuser, body-kit, wrap-paint, steering-wheel, roll-cage, electronics, clutch, differential, chassis-brace, ev-battery, ev-plug.
- **Domain:** garage-bay (Appendix C "garage"; the bare name is the Phosphor garage of the tab destinations), qr-sticker, dyno (Prüfstand), hu-plakette, service-wrench, tyre-season, insurance, workshop (Betrieb), part-box (Produkt), meet (Treffen), cruise-route (Ausfahrt), track-day.
- **Reactions:** strong (Stark), clean (Sauber), low (Tief), loud (Laut), each with `-fill` for the chosen reaction.

Appendix C: "filled variants only where a selected state needs one". The 2.0 systems and domain glyphs are regular only; asked for `weight="fill"` they draw their regular form, and the Blade sprite has no `-fill` symbol for them. No sparkle, flame or lightning shape inside any glyph.

Allowed in a source: `path`, `circle`, `rect`, `line`, `polyline` with geometry attributes only. No groups, transforms, ids, styles, text or colours; paint lives on the root `<svg>`. For a solid dot in a regular glyph use a small circle (`r="4"` gives a dot of radius 12 from the stroke alone).

`npm --prefix design run icons` validates the sources and generates React Native components (`mobile/src/ui/icons/auto/`), Vue components (`web/resources/js/shared/icons/auto/`) and a Blade sprite (`web/resources/views/components/icons/auto-sprite.blade.php`). `node design/scripts/build-icons.mjs --check` fails on a rule break (exit 1) or stale outputs (exit 2). Never edit generated files.
