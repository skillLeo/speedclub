import { router, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { PhWrench } from '@phosphor-icons/vue';
import { ref, type Component } from 'vue';
import { autoIcons } from '../../../shared/icons/auto';
import type { Tone } from '../../Components/ui';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../composables/recentPassword';
import { requestJson } from '../../lib/http';
import { routeOr } from '../../lib/routes';

/** ADM-14…17 (M3.3): shared types, URLs and the write helper of the catalogue pages. */
export type CatalogLevel = 'make' | 'model' | 'generation' | 'brand';

export interface MergedInto {
    id: number;
    name: string;
}

/** A make, model, generation or brand as the lists send it (only the keys of its level are set). */
export interface CatalogEntry {
    id: number;
    name: string;
    slug: string;
    active?: boolean;
    merged_into: MergedInto | null;
    vehicles?: number;
    country?: string | null;
    is_popular?: boolean;
    sort?: number;
    make_id?: number;
    model_id?: number;
    year_from?: number | null;
    year_to?: number | null;
    category_hint?: string | null;
    aliases?: string[];
    usage?: number;
}

export interface Candidate {
    id: number;
    name: string;
    slug: string;
    active: boolean;
    vehicles: number;
}

/** GET …/entries/{level}/{id}/impact (EntriesController::impact). */
export interface Impact {
    entry: { id: number; level: CatalogLevel; name: string; slug: string; merged: boolean; vehicles: number; modifications: number | null };
    references: { vehicles: number; modifications: number; aliases: number; collections: number };
    deletable: boolean;
    slug_locked: boolean;
    children: { models: number; generations: number };
    candidates: Candidate[];
}

export const REFERENCE_KINDS = ['vehicles', 'modifications', 'aliases', 'collections'] as const;

/** More affected vehicles than this need a second staff member (ADR-214/229). The server decides; the page says so ahead. */
export const FOUR_EYES_ABOVE = 100;

export function impactUrl(level: CatalogLevel, id: number): string {
    return routeOr('admin.catalog.entries.impact', `/admin/catalog/entries/${level}/${id}/impact`, { level, id });
}

export function fetchImpact(level: CatalogLevel, id: number): Promise<Impact> {
    return requestJson<Impact>('get', impactUrl(level, id));
}

export function entryUrl(level: CatalogLevel, id?: number): string {
    return id === undefined
        ? routeOr('admin.catalog.entries.store', `/admin/catalog/entries/${level}`, { level })
        : routeOr('admin.catalog.entries.update', `/admin/catalog/entries/${level}/${id}`, { level, id });
}

export const makeHref = (id: number): string => routeOr('admin.catalog.vehicles.make', `/admin/catalog/makes/${id}`, { make: id });
export const modelHref = (id: number): string => routeOr('admin.catalog.vehicles.model', `/admin/catalog/models/${id}`, { model: id });

/** Aktiv / Inaktiv / Zusammengeführt as a pill (DQ-537: one way everywhere). */
export function entryPill(entry: Pick<CatalogEntry, 'active' | 'merged_into'>): { tone: Tone; label: string } {
    if (entry.merged_into !== null) return { tone: 'info', label: trans('catalog.status.merged') };
    if (entry.active === false) return { tone: 'neutral', label: trans('catalog.status.inactive') };
    return { tone: 'success', label: trans('catalog.status.active') };
}

/** "1998–2006", "seit 2021", "–". */
export function yearsText(from: number | null | undefined, to: number | null | undefined): string {
    if (from && to) return `${from}–${to}`;
    if (from) return trans('catalog.years.since', { year: String(from) });
    if (to) return trans('catalog.years.until', { year: String(to) });
    return '–';
}

/**
 * One catalogue write from a drawer or dialog. Unlike the shared helper it keeps every field error (a drawer shows each one at its
 * field; a refusal comes back under `refused`, the other errors under their field), and for a ⚿ action (merge, delete, import apply)
 * asks for the password first when the last confirmation is older than 5 minutes (ADR-215).
 */
export function useCatalogWrite() {
    const page = usePage();
    const processing = ref(false);
    const errors = ref<Record<string, string>>({});
    const error = ref<string | null>(null);

    function run(method: 'post' | 'patch' | 'delete', url: string, data: Record<string, unknown>, options: { sensitive?: boolean; onSuccess?: () => void; forceFormData?: boolean } = {}): void {
        const go = (): void => {
            router.visit(url, {
                method,
                data: data as never,
                preserveScroll: true,
                preserveState: true,
                forceFormData: options.forceFormData,
                onStart: () => {
                    processing.value = true;
                    errors.value = {};
                    error.value = null;
                },
                onFinish: () => (processing.value = false),
                onSuccess: (next) => {
                    if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) return;
                    options.onSuccess?.();
                },
                onError: (next) => {
                    errors.value = next;
                    error.value = Object.values(next)[0] ?? trans('ui.state.error_title');
                },
            });
        };
        if (options.sensitive === true && !passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) confirmPasswordFirst(go);
        else go();
    }

    function reset(): void {
        errors.value = {};
        error.value = null;
    }

    return { processing, errors, error, run, reset };
}

export type EntryDialog = 'create' | 'edit' | 'active' | 'merge' | 'delete';

/** Which entry dialog of a catalogue page is open, for which entry (EntryDialogs renders them). */
export function useEntryDialogs() {
    const mode = ref<EntryDialog | null>(null);
    const entry = ref<CatalogEntry | null>(null);
    const presetTarget = ref<number | null>(null);

    function show(next: EntryDialog, row: CatalogEntry | null = null, preset: number | null = null): void {
        entry.value = row;
        presetTarget.value = preset;
        mode.value = next;
    }

    function close(): void {
        mode.value = null;
    }

    return { mode, entry, presetTarget, show, close };
}

export type EntryDialogsController = ReturnType<typeof useEntryDialogs>;

/** The glyph of a mod category's icon key (03 §6 custom auto set, DQ-595); a key outside the set shows the generic wrench. */
export function categoryGlyph(name: string | null | undefined): Component {
    if (name && name in autoIcons) return autoIcons[name as keyof typeof autoIcons];
    return PhWrench;
}
