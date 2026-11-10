/**
 * The legal status of a mod on the read side [SIG `sig.mod_legal_status`]: the pill on VEH-02 and the label on the mod rows.
 * The owner's statement only, so every place that shows it also shows "Angaben des Besitzers, keine rechtliche Prüfung". On a mod
 * row it is `ModRow`'s second pill (M2.8), no longer the end of the value line.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useFlag } from '@/api/queries/appConfig';
import type { PublicModRow } from '@/api/queries/vehicles';
import { LEGAL_STATUS_FLAG, legalStatusOf, showsLegalPill } from '@/features/garage/legalStatus';

type LegalFields = Pick<PublicModRow, 'legal_status' | 'legal_status_label'>;

/** The label to show, or null: the flag is off, nothing was stated, or "Unbekannt". The server's label comes first. */
export function legalLabel(mod: LegalFields, enabled: boolean, fallback: (status: string) => string): string | null {
  if (!enabled || !showsLegalPill(mod.legal_status)) return null;
  const status = legalStatusOf(mod.legal_status);
  return mod.legal_status_label?.trim() || (status ? fallback(status) : null);
}

export function useLegalLabel() {
  const enabled = useFlag(LEGAL_STATUS_FLAG);
  const { t } = useTranslation('garage');
  return useCallback(
    (mod: LegalFields) => legalLabel(mod, enabled, (status) => t(`mods.legalStatuses.${status}` as 'mods.legalStatuses.abe')),
    [enabled, t],
  );
}

/** The props of `ModRow`'s second pill: the stated status, and its name for screen readers ("Rechtlicher Status: ABE"). */
export type LegalPillProps = { legalStatus?: string; legalStatusLabel?: string };

/** `ModRow`'s legal pill for a mod while the flag is on; nothing for a mod without a stated status. */
export function useLegalPill() {
  const label = useLegalLabel();
  const { t } = useTranslation('vehicle');
  return useCallback(
    (mod: LegalFields): LegalPillProps => {
      const legal = label(mod);
      return legal ? { legalStatus: legal, legalStatusLabel: `${t('mod.legalStatus')}: ${legal}` } : {};
    },
    [label, t],
  );
}
