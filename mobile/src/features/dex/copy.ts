import type { TFunction } from 'i18next';

import type { SpotRefusal } from '@/api/queries/dex';

/** The scanner's words for a refused spot: a calm title and one line of what to do (no codes, no guilt). */
export function refusalCopy(t: TFunction, reason: SpotRefusal): { title: string; body: string } {
  return { title: t(`refusal.${reason}.title`), body: t(`refusal.${reason}.body`) };
}

/** "0087": the Dex number as the card prints it, four digits at least. */
export function dexNumberText(dexNumber: number | null | undefined): string | null {
  return typeof dexNumber === 'number' && Number.isInteger(dexNumber) && dexNumber > 0 ? String(dexNumber).padStart(4, '0') : null;
}
