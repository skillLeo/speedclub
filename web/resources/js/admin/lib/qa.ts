/**
 * QA hooks for the visual matrix (contract §2.6), active outside production only:
 * ?qaState=loading|empty|error · ?qaTheme=carbon|light · ?qaLocale=de|en · ?qaNow=<ISO> · ?qaMotion=off · ?qaFontScale=1|2
 *
 * While they are active, <html> reports what was actually applied (the harness contract of tests/e2e/support/qa.mjs, the same as the
 * member app): data-qa-theme, data-qa-locale, data-qa-font-scale, data-qa-state, data-qa-motion.
 */
export type QaState = 'loading' | 'empty' | 'error';

let enabled = false;
let frozenNow: Date | null = null;

function param(name: string): string | null {
    if (!enabled || typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(name);
}

function report(key: 'qaTheme' | 'qaLocale' | 'qaFontScale' | 'qaState' | 'qaMotion', value: string): void {
    if (enabled) document.documentElement.dataset[key] = value;
}

export function initQa(env: string): void {
    enabled = env !== 'production';
    if (!enabled) return;
    const now = param('qaNow');
    if (now !== null && !Number.isNaN(Date.parse(now))) frozenNow = new Date(now);
    const motion = param('qaMotion') === 'off' ? 'off' : 'on';
    if (motion === 'off') document.documentElement.classList.add('qa-motion-off');
    report('qaMotion', motion);
    // Browser-zoom equivalent (ADR-212's 200 % cell): the admin's type is in px, so the whole page scales.
    const scale = Number(param('qaFontScale') ?? '1');
    const applied = scale === 2 ? 2 : 1;
    if (applied === 2) document.documentElement.classList.add('qa-font-scale-2');
    report('qaFontScale', String(applied));
    reportQaState();
}

export function qaEnabled(): boolean {
    return enabled;
}

/** The state forced by ?qaState=, read from the current URL so it follows navigation. */
export function qaState(): QaState | null {
    const state = param('qaState');
    return state === 'loading' || state === 'empty' || state === 'error' ? state : null;
}

/** Called on start and after each visit: the state the pages apply (usePageState honours the same parameter). */
export function reportQaState(): void {
    report('qaState', qaState() ?? 'default');
}

export function reportQaTheme(theme: string): void {
    report('qaTheme', theme);
}

export function reportQaLocale(locale: string): void {
    report('qaLocale', locale);
}

export function qaTheme(): 'carbon' | 'light' | null {
    const theme = param('qaTheme');
    return theme === 'carbon' || theme === 'light' ? theme : null;
}

export function qaLocale(): 'de' | 'en' | null {
    const locale = param('qaLocale');
    return locale === 'de' || locale === 'en' ? locale : null;
}

/** "Now" for relative times and the idle timer; frozen by ?qaNow= so captures are stable. */
export function now(): Date {
    return frozenNow === null ? new Date() : new Date(frozenNow.getTime());
}

/**
 * A side request whose answer the server dates (QaClock, such as the appeal deadline of the decision preview) carries the page's
 * ?qaNow=, so a capture shows the same date every day (DQ-700). Unchanged outside QA or without a frozen clock.
 */
export function withQaNow(url: string): string {
    if (!enabled || frozenNow === null) return url;
    return `${url}${url.includes('?') ? '&' : '?'}qaNow=${encodeURIComponent(frozenNow.toISOString())}`;
}

export function motionOff(): boolean {
    return document.documentElement.classList.contains('qa-motion-off') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
