import { vueTsConfigs, withVueTs } from '@vue/eslint-config-typescript';
import pluginVue from 'eslint-plugin-vue';

export default withVueTs(
    {
        ignores: [
            'bootstrap/**',
            'node_modules/**',
            'public/**',
            'resources/js/shared/*.generated.ts',
            'storage/**',
            'tests/e2e/**',
            'vendor/**',
        ],
    },
    pluginVue.configs['flat/recommended'],
    vueTsConfigs.recommendedTypeChecked,
    {
        // Inertia pages are named after their route (Pages/Auth/Login.vue), generated icons after their glyph.
        files: ['resources/js/admin/Pages/**/*.vue', 'resources/js/shared/icons/**/*.vue'],
        rules: {
            'vue/multi-word-component-names': 'off',
        },
    },
    {
        // ADR-213: no literal UI text in admin templates; every string goes through laravel-vue-i18n (check-admin-i18n.mjs).
        files: ['resources/js/admin/**/*.vue'],
        rules: {
            'vue/no-bare-strings-in-template': 'error',
        },
    },
    {
        rules: {
            // Formatting belongs to Prettier.
            'vue/html-indent': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/singleline-html-element-content-newline': 'off',
            'vue/html-self-closing': 'off',
            'vue/html-closing-bracket-newline': 'off',
        },
    },
);
