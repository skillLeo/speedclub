# Vehicle view (VEH-01 to VEH-05)

The public build page and what hangs off it. Routes live in `src/app/(tabs)/(home,discover,garage,messages,profile)/v/[slug]/…`
(shared by all five tabs) and `src/app/(modals)/viewer.tsx`; each is one line that renders a screen from `screens/`.

| Route | Screen | Data |
|---|---|---|
| VEH-01 `/v/[slug]` (`?tab=specs\|mods\|history`) | `VehicleScreen` → `VehicleProfile` | `usePublicVehicle(slug)` |
| VEH-02 `/v/[slug]/mods/[modId]` | `ModDetailScreen` | `usePublicMod(slug, modId)` |
| VEH-03 `/v/[slug]/gallery` (`?category=`) | `GalleryScreen` | the page query |
| VEH-04 `(modals)/viewer?slug=&index=&category=&mod=` | `ViewerScreen` | the page or the mod query |
| VEH-05 `/v/[slug]/updates/[updateId]` | `UpdateDetailScreen` | `usePublicUpdate(slug, updateId)` |

Hooks are in `src/api/queries/vehicles.ts`. Keys are `['public-vehicle', publicId, viewer, …]`: the API renders per viewer
(language, power setting, owner-only values), so a sign-in or a language change reads again. After an owner edit call
`invalidatePublicVehicle(slug)`, which covers every viewer and every sub-route of that vehicle.

## `VehicleProfile` for GAR-02

GAR-02 is "public layout + owner toolbar" (04_SCREEN_REGISTER). The owner reads their own vehicle through the same public
route, also when it is private or a draft (`is_owner: true`, owner-only values filled), so GAR-02 does not need a second
layout:

```tsx
import { usePublicVehicle } from '@/api/queries/vehicles';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { VehicleProfileSkeleton } from '@/features/vehicle/components/VehicleProfileSkeleton';
import { useRouteState, RouteStateBody } from '@/features/vehicle/states';

const query = usePublicVehicle(card.slug); // the slug from me/vehicles or vehicles/{id}
const state = useRouteState(query);
// The skeleton draws the toolbar's buttons as blocks of their real size, and on a desktop as many thumbnails as the photos.
if (state === 'loading') return <VehicleProfileSkeleton routeId="GAR-02" onBack={back} toolbarLabels={ownerToolLabels(t, hasQr)} photoCount={card?.photo_count} />;
if (state !== 'ready' || !query.data) return <StateScreen …><RouteStateBody state={…} … /></StateScreen>;
return (
  <VehicleProfile
    vehicle={query.data}
    routeId="GAR-02"
    onBack={back}
    ownerToolbar={<OwnerToolbar vehicle={query.data} />}   // Bearbeiten, Mods, Fotos, QR, Sichtbarkeit
    ownerContent={<CompletenessHints vehicle={query.data} />} // first block of Übersicht
    headerActions={[/* optional: replaces share + more */]}
  />
);
```

| Prop | Type | What it does |
|---|---|---|
| `vehicle` | `PublicVehicleResource` | Everything the page shows. |
| `routeId` | `string`, default `VEH-01` | Prefix of every test ID: `.root`, `.header`, `.hero`, `.title`, `.specStrip`, `.ownerRow`, `.tabs.<tab>`, `.panel.<tab>`, `.ownerToolbar`. VEH-01 keeps the WEB-01 parity IDs. |
| `onBack` | `() => void` | The header's back. |
| `ownerToolbar` | `ReactNode` | Under the owner row (phone, tablet) and in the sticky card (desktop). With a toolbar the owner row shows no guest actions. |
| `ownerContent` | `ReactNode` | First block of Übersicht, 32 above the description. |
| `headerActions` | `HeaderAction[]` | Replaces share and more. Without it the more sheet offers "Link kopieren" and, for the owner, "In der Garage bearbeiten" and "QR-Code anzeigen". |
| `tab`, `onTabChange` | `ProfileTab` | Controlled tab (`overview`, `specs`, `mods`, `history`); uncontrolled by default. |

What the component owns: the photo header over the hero on phones (a bar above the content when there is no photo, on
tablets and desktops), the sticky content tabs (CSS `position: sticky` on web, a UI-thread transform on native, see
`layout.ts`), the in-place image viewer, the more sheet, share, re-tap to top, the offline banner and the tab bar padding.
Layout per width: phone below 768, one centred column of 768 on a tablet, from 1280 gallery 7/12 beside a sticky card 5/12.

## Phase 2 seams (no UI until the feature exists)

- **Follow and message for members**: guests get Folgen and Nachricht (auth-required sheet, back to this page). Members get
  Folgen (`FollowButton`, M2.1); Nachricht for members arrives with messaging (M2.4) in `VehicleProfile` (`memberFollow`) and
  the closing owner card (`closingAction`).
- **Save** [SIG `sig.saved_builds`, M2.1]: a header action (`save.ts` holds the glyph) for members and guests, never on your
  own build; the server's `is_saved` is null for the owner and without the flag.
- **More sheet**: report and compare (VEH-06) become rows in `MoreSheet` via `moreActions`. PROF-02 reuses the sheet.
- **Share cards** (VEH-07) join the share action; **similar builds** (`sig.similar_builds`) become a block in `OverviewSection`.
- **Legal status** (`sig.mod_legal_status`, M2.7; ADR-153): the field is not shown, and Phase 1 keeps the flag off in every
  environment so WEB-01 shows no pill either (DQ-164). The disclaimer of 08_LEGAL §7 closes every non-empty mod list (the
  Mods tab, as on WEB-01) and VEH-02, and is absent from the empty state on both surfaces. Since M2.8 a stated status is
  `ModRow`'s second pill (`legalStatus`, from `useLegalPill`): under the values on the text's edge, never beside the install
  status, so the name keeps its width at 360 and 200 %. Highlights and GAR-09 then end with the disclaimer too.
- **"Ähnliche suchen"** on VEH-02 waits for Discover's search by part (M1.8).
- **Owner profile**: the owner row opens PROF-02 (`/u/[username]`), or PROF-01 for your own build (M2.1).

## States

`states.tsx` maps a query to `loading`, `ready`, `unavailable` (every hidden vehicle, one calm state without a reason,
ADR-141), `notFound` (a mod or entry of a visible vehicle), `error` with retry, and `offline` without a copy. Offline with a
copy is `ready` under the shell's banner. `qaState` forces `loading`, `error`, `restricted` (shown as unavailable: a public
page has no account limit of its own) and `empty` (the same vehicle without photos, description, mods and Verlauf).
