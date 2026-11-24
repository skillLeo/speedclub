import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import laravel from 'laravel-vite-plugin';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import pruneTokens from './scripts/vite-prune-tokens.mjs';

export default defineConfig({
    plugins: [
        laravel({
            input: [
                'resources/js/admin/app.ts',
                'resources/css/admin.css',
                'resources/css/public.css',
                'resources/js/public/app.ts',
            ],
            refresh: true,
        }),
        tailwindcss(),
        // The public stylesheet is inlined into every public page: only the tokens those pages read (scripts/vite-prune-tokens.mjs).
        pruneTokens({ root: fileURLToPath(new URL('.', import.meta.url)), entry: 'resources/css/public.css' }),
        vue({
            template: {
                transformAssetUrls: { base: null, includeAbsolute: false },
            },
        }),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js/admin', import.meta.url)),
        },
    },
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**', '**/public/app/**'],
        },
    },
});
