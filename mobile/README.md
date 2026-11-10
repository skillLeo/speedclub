# SPEED CLUB — member app

Expo SDK 58 / React Native 0.88 app for iOS and Android. The same code is exported as the member web app served by the backend at `/app`.

## Structure

| Path | Contents |
|---|---|
| `src/app` | Expo Router routes (tabs, stacks, shared routes) |
| `src/features/*` | Feature modules: auth, home, discover, garage, vehicle, qr, messages, profile, settings, safety … |
| `src/ui` | Design-system primitives (buttons, fields, sheets, dialogs, toasts, photos, skeletons) |
| `src/theme` | Generated tokens and the Carbon, Black and Light themes |
| `src/api` | API client, typed from the backend's OpenAPI document, and TanStack Query hooks |
| `src/i18n` | German and English strings, one namespace per feature |
| `tests` | Jest + React Native Testing Library |
| `e2e/maestro` | Native smoke flows |

## Development

```bash
npm install
npx expo start            # iOS simulator, Android emulator or Expo Go
npm run web               # member web in the browser
npm run verify            # tsc (strict), ESLint, Jest, i18n checks
npm run export:web        # export the member web into ../web/public/app
```

Android release builds: `../scripts/build-apk.ps1 -Target lan | staging | production`. iOS builds: the EAS profiles in `eas.json` (`../docs/IOS_TESTFLIGHT.md`).
