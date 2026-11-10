import { useTranslation } from 'react-i18next';

import { formatNumber, parseNumber, roundInt } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';

import type { SpecsValues } from './model';

const UNIT_LABEL = { ps: 'PS', kw: 'kW', hp: 'hp' } as const;

/** The preview card's chips from the form as it is now: "280 PS", "392 Nm", "Allrad" (§8 spec chips). */
export function useSpecChips(values: Partial<SpecsValues>): string[] {
  const { t } = useTranslation('garage');
  const { locale } = useFormat();
  const chips: string[] = [];
  const power = parseNumber(values.powerValue ?? '', locale);
  if (Number.isFinite(power) && power > 0) chips.push(`${formatNumber(roundInt(power), locale)} ${UNIT_LABEL[values.powerUnit ?? 'ps']}`);
  const torque = parseNumber(values.torque ?? '', locale);
  if (Number.isFinite(torque) && torque > 0) chips.push(`${formatNumber(roundInt(torque), locale)} Nm`);
  if (values.drivetrain) chips.push(t(`specs.drivetrains.${values.drivetrain}`));
  return chips;
}
