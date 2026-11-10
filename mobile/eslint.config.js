const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const reactNative = require('eslint-plugin-react-native');
const noRawStyleValues = require('./eslint-rules/no-raw-style-values');

module.exports = defineConfig([
  expoConfig,
  globalIgnores([
    'dist/*',
    'android/*',
    'ios/*',
    '.expo/*',
    'src/theme/tokens.generated.ts',
    'src/api/schema.d.ts',
    'src/ui/icons/auto/*',
    'expo-env.d.ts',
  ]),
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-native': reactNative,
      speedclub: { rules: { 'no-raw-style-values': noRawStyleValues } },
    },
    rules: {
      'react-native/no-color-literals': 'error',
      'react-native/no-inline-styles': 'error',
      'speedclub/no-raw-style-values': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
]);
