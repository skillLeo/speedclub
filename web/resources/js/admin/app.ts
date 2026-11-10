import { createInertiaApp, router } from '@inertiajs/vue3';
import { i18nVue, loadLanguageAsync } from 'laravel-vue-i18n';
import { ConfigProvider } from 'reka-ui';
import { createApp, h, type DefineComponent } from 'vue';
import { ZiggyVue } from 'ziggy-js';
import AdminLayout from './Layouts/AdminLayout.vue';
import AuthLayout from './Layouts/AuthLayout.vue';
import { adminMessages } from './lib/i18n';
import { initQa, qaLocale, reportQaLocale, reportQaState } from './lib/qa';
import { initTheme } from './lib/theme';
import type { SharedPageProps } from '@inertiajs/core';

const pages = import.meta.glob<DefineComponent>('./Pages/**/*.vue');

/** The CSP nonce of this response (SecurityHeaders); every injected <style> must carry it, the policy is never loosened. */
const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;

function setLang(locale: string): void {
    document.documentElement.lang = locale;
    reportQaLocale(locale);
}

void createInertiaApp({
    // Inertia injects the styles of its progress bar and error dialog; the CSP only lets them in with the nonce.
    defaults: {
        nonce,
    },
    title: (title) => (title ? `${title} · SPEED CLUB Admin` : 'SPEED CLUB Admin'),
    resolve: async (name) => {
        const loader = pages[`./Pages/${name}.vue`];
        if (loader === undefined) throw new Error(`Unknown admin page ${name}`);
        return loader();
    },
    // Sign-in pages and errors without a session use the narrow layout; everything else the shell (03 §14).
    layout: (name, page) => {
        if (name.startsWith('Auth/')) return AuthLayout;
        if (name === 'Error') return (page.props as unknown as SharedPageProps).staff?.two_factor_confirmed === true ? AdminLayout : AuthLayout;
        return AdminLayout;
    },
    progress: {
        color: 'var(--sc-color-accent-fill)',
    },
    setup({ el, App, props, plugin }) {
        // Before the first render: QA overrides (non-production only) and the stored theme.
        initQa(props.initialPage.props.app.env);
        initTheme();
        const locale = qaLocale() ?? props.initialPage.props.app.locale;
        setLang(locale);

        // Reka's Select and Combobox viewports inject a <style> to hide their scrollbar: ConfigProvider hands them the nonce
        // (reka-ui useNonce), so the CSP accepts it in every browser instead of logging a violation.
        const app = createApp({ render: () => h(ConfigProvider, { nonce }, { default: () => h(App, props) }) })
            .use(plugin)
            .use(ZiggyVue)
            .use(i18nVue, {
                lang: locale,
                fallbackLang: 'de',
                resolve: (lang: string) => adminMessages(lang),
            });
        // The messages are bundled, but laravel-vue-i18n applies them a promise tick later (loadLanguageAsync). Mounting before that
        // let a trans() in a page's setup or onMounted keep the raw key in a ref, as the QA-forced dialog errors did (DQ-699).
        void loadLanguageAsync(locale).then(() => app.mount(el));

        // The DE/EN toggle answers with the new locale in the shared props.
        router.on('navigate', () => reportQaState());
        router.on('success', (event) => {
            const next = (event.detail.page.props as SharedPageProps).app.locale;
            if (next !== document.documentElement.lang && qaLocale() === null) {
                setLang(next);
                void loadLanguageAsync(next);
            }
        });
    },
});
