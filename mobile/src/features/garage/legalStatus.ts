/**
 * The legal status of a mod [SIG `sig.mod_legal_status`] (FS-6, 08_LEGAL_COMPLIANCE §7): the owner's own statement, never
 * checked by SPEED CLUB, so wherever it shows, "Angaben des Besitzers, keine rechtliche Prüfung" shows with it. While the flag
 * is off the API answers null and ignores the field (ADR-153), and the app neither shows nor sends it.
 */
import type { components } from '@/api/schema';

export type LegalStatus = components['schemas']['LegalStatus'];

export const LEGAL_STATUS_FLAG = 'sig.mod_legal_status';

/** The order of the picker: the documents first, "Unbekannt" last. */
export const LEGAL_STATUSES = [
  'abe',
  'parts_certificate',
  'registered',
  'individual_approval',
  'not_required',
  'unknown',
] as const satisfies readonly LegalStatus[];

const KNOWN = new Set<string>(LEGAL_STATUSES);

/** The resource carries the value as a plain string; only the six of the enum count. */
export function legalStatusOf(value: string | null | undefined): LegalStatus | null {
  return value && KNOWN.has(value) ? (value as LegalStatus) : null;
}

/**
 * Whether a row shows a pill. "Unbekannt" is what the server stores when nothing was chosen, so it would put the same pill on
 * every mod and say nothing: only a stated status shows.
 */
export function showsLegalPill(value: string | null | undefined): boolean {
  const status = legalStatusOf(value);
  return status !== null && status !== 'unknown';
}
