# Navigation shell

How a feature module plugs a screen in. The route tree is already there (`04_SCREEN_REGISTER.md` §2).

## Replace a placeholder

Every P1 route is a one-line file. Change only that line:

```tsx
// src/app/(tabs)/(garage)/garage/[id]/basics.tsx
import { EditBasicsScreen } from '@/features/garage/screens/EditBasicsScreen';

export default function Route() {
  return <EditBasicsScreen />;
}
```

Never add a `_layout.tsx` in `(home)`, `(discover)`, `(garage)`, `(messages)` or `(profile)`.

## What a screen has to do

- **Root test ID:** `<Screen testID="<ROUTE-ID>.root">`, sub-elements `<ROUTE-ID>.<element>`. Every route renders `Screen`, because it opens the first-screen gate.
- **Tab roots** use `TabRootScreen` (large title, collapse, offline banner, re-tap, tab-bar padding). With a FlashList, copy what that file does and use `CollapsingFlashList`.
- **Pushed screens inside a tab:** `Screen edges={['left','right']}`, then `Header` with `onBack`, then `ShellOfflineBanner`.
- **The tab bar floats over the content** on phones, so its blur has something to blur. Scroll content ends with `useTabBarPadding()` (`useTabBarInset()` for a number). A non-scrolling screen puts the padding on its body. Both are zero with a rail, a sidebar, or outside the tabs.
- **Editors pushed inside a tab** (`/garage/[id]/basics` and similar) call `useHideTabBar()` (§9).
- **Scrolling screens other than tab roots** call `useTabScrollToTop()`, so re-tap scrolls first.

## Toasts

`toast()` from `@/ui`. The one shell host sits 8 above the tab bar, above the `StickyCTABar` of the focused screen (the bar reports its height through `useFocusEffect`, `src/ui/toastPlacement.ts`) and above the keyboard. A screen does nothing for it. A Jest test that mocks `expo-router` and renders a `StickyCTABar` needs `useFocusEffect` in that mock.

## Guests and accounts

```tsx
const requireAuth = useRequireAuth(); // src/state/session.ts
<Button onPress={() => requireAuth(follow, { returnTo: pathname })} />
```

A guest gets the auth-required sheet; a member runs the action at once; during the session restore the tap is ignored. The action is for in-place effects such as a follow; navigation belongs in `returnTo`. After sign-in, M1.5 calls `completeAuthIntent()`, which runs the action and returns the path. M1.5 restores the session through `registerSessionRestore()`.

- A `returnTo` read from the URL goes through `isInternalPath()` before anything follows it.
- A direct way into sign-in calls `clearAuthIntent()` first. Leaving `(auth)` without signing in drops the intent by itself.

## Data

- `api` + `apiData()` from `src/api/client.ts`. Every failure is an `ApiError` with `kind`, `fieldErrors`, `retryAfter`.
- Creating POST: `api.POST(path, { body, ...withIdempotency(key) })`, with `key` from `newIdempotencyKey()`, kept across retries of the same intent.
- `useAppConfig()` is always available: flags, branding, links. It never blocks and never fails.
- `useOnline()` from `src/state/online.ts`; `qaState=offline` forces it off.

## Removed with M1.6

`QaRouteProbe`, `GarageRootPlaceholder` and the sample vehicle link are gone: GAR-01 is the real garage, and the ADR-101 specs (`nav-shared-routes.spec.ts`, `nav-shared-routes.yaml`) open a vehicle from PROF-01's garage strip. `TabPlaceholder` is gone too: every tab root has its screen, and the shell tests (`tests/shell/shell.test.tsx`, `shellToast.test.tsx`) bring a stand-in tab of their own on `TabRootScreen`.
