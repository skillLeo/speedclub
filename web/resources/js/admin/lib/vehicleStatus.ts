import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../Components/ui/Badge.vue';

/**
 * One status presentation for vehicles on every admin surface (DQ-537): visibility is always a StatusPill (Öffentlich = success,
 * Nicht gelistet / Privat / Entwurf = neutral, deleted = neutral), moderation is a pill only for an exception (Gemeldet = warning,
 * Ausgeblendet = danger) and "–" in ink-3 for the normal state.
 */
export interface VehicleState {
    status: string;
    visibility: string;
    hidden?: boolean;
    reported?: boolean;
    deleted?: boolean;
}

export function visibilityPill(v: VehicleState): { tone: Tone; label: string } {
    if (v.deleted === true) return { tone: 'neutral', label: trans('vehicles.status.deleted') };
    if (v.status !== 'published') return { tone: 'neutral', label: trans(`vehicles.status.${v.status}`) };
    return { tone: v.visibility === 'public' ? 'success' : 'neutral', label: trans(`vehicles.visibility.${v.visibility}`) };
}

/** null = the normal state (shown as "–"). */
export function moderationPill(v: VehicleState): { tone: Tone; label: string } | null {
    if (v.hidden === true) return { tone: 'danger', label: trans('vehicles.moderation.hidden') };
    if (v.reported === true) return { tone: 'warning', label: trans('vehicles.moderation.reported') };
    return null;
}

/** The header pill of ADM-12: a hidden or deleted vehicle says so first, otherwise its visibility. */
export function recordPill(v: VehicleState): { tone: Tone; label: string } {
    if (v.deleted === true) return { tone: 'neutral', label: trans('vehicles.status.deleted') };
    return moderationPill({ ...v, reported: false }) ?? visibilityPill(v);
}
