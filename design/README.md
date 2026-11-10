# design/

| Folder / file | What it is | Who edits |
|---|---|---|
| `tokens/tokens.json` | **Single source of truth** for colours (Carbon · Black · Light), accent palette, typography, spacing, radii, sizes, layout, motion. | Design team (with design review) |
| `scripts/build-tokens.mjs` | Generates `mobile/src/theme/tokens.generated.ts`, `web/resources/css/tokens.generated.css`, `web/resources/css/tailwind-theme.generated.css`, `web/resources/js/shared/tokens.generated.ts` and runs the **WCAG contrast gate**. `--check` = verify mode. | — |
| `brand/` | The client's original logo files (see `brand/README.md`). Never redrawn. | Owner |
| `icons/auto/` | 16 custom automotive SVG glyphs on Phosphor's grid (wheel, tyre, coilover, air-suspension, exhaust, turbo, intake, engine, ecu-chip, brake-disc, wing, seat, light, audio, gearbox, drivetrain). | Design team |
| `seed-photos/` | Real, licensed car photos for demo data and design QA, with `CREDITS.md`. No AI-generated images. | Owner (or the team, free-licensed photos only) |

Run `node design/scripts/build-tokens.mjs` after every token change; commit the JSON and the generated files together.
