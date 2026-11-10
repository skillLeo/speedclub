import { trans } from 'laravel-vue-i18n';
import { now } from '../../lib/qa';

/**
 * The statement of reasons a staff decision carries (Art. 17 DSA, m3.2-contract §1; server: App\Services\Moderation\Statement):
 * facts and ground in the staff member's words, where the ground is written, and the section. The templates fill it, and every field
 * stays editable before sending (06 §3 "editable before sending").
 */
export interface StatementForm {
    template: string;
    facts: string;
    ground: string;
    ground_document: 'community' | 'terms' | 'law';
    ground_section: string;
}

export const TEMPLATE_KEYS = ['spam', 'harassment', 'impersonation', 'nudity', 'illegal', 'other'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const DOCUMENTS: Record<TemplateKey, { document: StatementForm['ground_document']; section: string }> = {
    spam: { document: 'community', section: '4' },
    harassment: { document: 'community', section: '2' },
    impersonation: { document: 'terms', section: '6' },
    nudity: { document: 'community', section: '3' },
    illegal: { document: 'law', section: '' },
    other: { document: 'community', section: '' },
};

export function emptyStatement(): StatementForm {
    return { template: '', facts: '', ground: '', ground_document: 'community', ground_section: '' };
}

/** Fills the form from a template; the texts come from decisions.templates.<key> in the staff member's language. */
export function applyTemplate(form: StatementForm, key: string, subject: 'member' | 'vehicle' | 'photo'): void {
    const template = (TEMPLATE_KEYS as readonly string[]).includes(key) ? (key as TemplateKey) : null;
    form.template = key;
    if (template === null) return;
    if (template === 'other') {
        // Own statement: empty fields, the staff member writes everything.
        Object.assign(form, { facts: '', ground: '', ground_document: 'community', ground_section: '' });
        return;
    }
    form.facts = trans(`decisions.templates.${template}.facts_${subject}`);
    form.ground = trans(`decisions.templates.${template}.ground`);
    form.ground_document = DOCUMENTS[template].document;
    form.ground_section = DOCUMENTS[template].section;
}

/** The fields the server validates (Statement::rules()). */
export function statementPayload(form: StatementForm): Record<string, string | null> {
    return {
        facts: form.facts.trim(),
        ground: form.ground.trim(),
        ground_document: form.ground_document,
        ground_section: form.ground_section.trim() === '' ? null : form.ground_section.trim(),
    };
}

/** Client checks before the request (the server checks again): facts 10–5000, ground 3–2000. */
export function statementErrors(form: StatementForm): Partial<Record<'facts' | 'ground', string>> {
    const errors: Partial<Record<'facts' | 'ground', string>> = {};
    const facts = form.facts.trim().length;
    const ground = form.ground.trim().length;
    if (facts < 10 || facts > 5000) errors.facts = trans('decisions.errors.facts');
    if (ground < 3 || ground > 2000) errors.ground = trans('decisions.errors.ground');
    return errors;
}

export type Duration = '1' | '7' | '30' | 'date' | 'none';

/**
 * The end of a measure as ISO 8601: 1/7/30 days from now, the end of the chosen Berlin day (an ISO day "2026-06-21"), or null for none.
 * The admin's clock (`now()`) follows ?qaNow= so captures stay stable.
 */
export function untilFrom(duration: Duration, day: string): string | null {
    if (duration === 'none') return null;
    if (duration === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
        // 23:59:59 Berlin: in summer UTC+2, in winter UTC+1. Asking Intl for the offset of that day keeps it exact.
        const probe = new Date(`${day}T12:00:00Z`);
        const offset = berlinOffsetMinutes(probe);
        const end = new Date(Date.parse(`${day}T23:59:59Z`) - offset * 60_000);
        return end.toISOString();
    }
    return new Date(now().getTime() + Number(duration) * 86_400_000).toISOString();
}

function berlinOffsetMinutes(date: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' }).formatToParts(date);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
    const match = /GMT([+-]\d+)(?::(\d+))?/.exec(name);
    if (!match) return 60;
    const hours = Number(match[1]);
    const minutes = Number(match[2] ?? '0');
    return hours * 60 + Math.sign(hours) * minutes;
}

/** First message of an Inertia error bag, for the dialog's error line. */
export function firstError(errors: Record<string, string>): string {
    return Object.values(errors)[0] ?? trans('ui.state.error_title');
}
