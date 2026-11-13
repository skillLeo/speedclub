# iOS first run — checks that could not run on this Mac

There is no Xcode and no Apple Developer account yet (09 §0.5, OA-15), so every iOS-only path is type-checked, unit-tested and
flag-guarded, and listed here for the first real device or simulator run. M4.18 completes this list.

## M4.5 Navigation shell (6464fb7)
- NativeTabs with Liquid Glass: SF Symbols render, the tint follows the theme, no flicker when switching dark/light.
- `minimizeBehavior="onScrollDown"` hides and restores the bar on every tab.
- Re-tap on the active tab pops to the stack root and scrolls to top with `CollapsingFlashList`.
- Content insets: the first scroll view of each tab clears the bar (`useTabBarPadding` is 0 under native tabs).
- The toast clears the bar (the measured obstruction may be 0 on iOS); the e-mail-verification notice sits above the bar.
- `headerLargeTitle` (native large titles) is not wired; iOS keeps the JS CollapsingHeader.
- `Link.AppleZoom` (SM4) behind `ios.apple_zoom` arrives with the card → detail routes (M4.8/M4.9).

## M4.3 Motion kit (3e6efd1)
- Haptics map (§4.8) on a real device: selection on tab change, light/medium where specified, the user toggle.
- FlightLayer above native-stack screens; no flights into or out of RN Modal (documented limitation).
