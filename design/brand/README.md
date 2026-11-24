# Client brand files

| File | Use |
|---|---|
| `logo-wide-white.png` | Main logo on dark (Carbon/Black themes): Welcome, splash, web landing, share cards, OG images, QR sticker |
| `logo-wide-black.png` | Light theme, e-mails, PDFs (placard, sticker sheet) |
| `logo-square-white.png` / `logo-square-black.png` | Stacked version: splash, app-icon picker, square social images |
| `app-mark.png` / `app-mark-letters.png` | The client's app icon (stacked letters on the brush texture) and its letters alone: iOS/Android icon, Android monochrome icon, favicons |
| `logo-wide-on-texture.jpg` / `logo-square-on-texture.jpg` | The app mark with the brush texture — brand moments only (landing hero, social/OG backgrounds) |

The transparent PNGs were extracted from the client's JPEGs with a luminance un-blend (no AI background remover): true edge coverage, no grey halo, brush detail kept, pure #FFFFFF / #000000 artwork. Resolution: wide ≈ 1500 px, square ≈ 1100 px — enough for app, web and small stickers.
**Still wanted from the client:** the original vector files (AI / SVG / PDF / EPS) for large prints and merchandise. When they arrive, put them here and regenerate the derived assets.

Rules: never redraw, distort, outline or recolour the logo (only pure white or pure black); always keep the katakana line with the wordmark; minimum clear space = the height of the katakana line on every side.

**Client round 3 (2026-11-19):** the client replaced the logo in the admin; these files are now derived from those uploads (wordmark 700 × 225, app mark 1254 × 1254, both from `/storage` on staging). The transparent versions come from the luminance of the white artwork (letters of the app mark: luminance 150–245 ramp, which leaves the darker brush texture out). The app mark is stored as exact greyscale (its colour channels differed by at most 11 levels of compression noise), so the web icons stay indexed and lossless. The new logo has no katakana line. The wordmark is only 696 px wide: the 1280 web file is enlarged until the vector files arrive.
