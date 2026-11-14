// Metro on top of Expo's defaults (docs.expo.dev/guides/customizing-metro). One change (m4.18, 09 §12 member web budget):
//
// zod's `z.locales` namespace re-exports every one of its 64 error-message locales, and without tree shaking each lands in the
// bundle (≈ 300 KB of the web's __common chunk) and is parsed on every start. The app never calls `z.config(z.locales.xx())`:
// forms set their own messages through i18n, and zod registers its default English messages from `locales/en.js` directly
// (classic/schemas.js). So the namespace resolves to a module with English only; `z.locales.en` keeps working.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const ZOD_LOCALES_INDEX = /^\.\.\/locales\/index\.c?js$/;
const ZOD_V4 = /[\\/]node_modules[\\/]zod[\\/]v4[\\/](core|classic|mini)[\\/]/;
const zodLocalesEnglishOnly = path.join(__dirname, 'metro', 'zod-locales-en.js');

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (ZOD_LOCALES_INDEX.test(moduleName) && ZOD_V4.test(context.originModulePath)) {
    return { type: 'sourceFile', filePath: zodLocalesEnglishOnly };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
