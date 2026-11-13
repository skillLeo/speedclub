/**
 * SET-11 units (09 §7.9, §8.11; M4.13 API `distance_unit`, `torque_unit`, `weight_unit`): what the app shows; the server keeps km,
 * Nm and kg and nothing stored changes its unit. A small store like the power display (lib/powerDisplay.ts), so `useFormat()`
 * follows the choice on every screen. The device keeps the last values (`sc.units`) for the next start; the account's settings
 * set them once they load.
 */
import { create } from 'zustand';

import { formatNumber, roundInt, type FormatLocale } from './format';
import { getStored, setStored } from './storage';

export type DistanceUnit = 'km' | 'mi';
export type TorqueUnit = 'nm' | 'lbft';
export type WeightUnit = 'kg' | 'lb';
export type DisplayUnits = { distance: DistanceUnit; torque: TorqueUnit; weight: WeightUnit };

export const DEFAULT_UNITS: DisplayUnits = { distance: 'km', torque: 'nm', weight: 'kg' };
export const DISTANCE_UNITS: readonly DistanceUnit[] = ['km', 'mi'];
export const TORQUE_UNITS: readonly TorqueUnit[] = ['nm', 'lbft'];
export const WEIGHT_UNITS: readonly WeightUnit[] = ['kg', 'lb'];

export const KM_PER_MILE = 1.609344;
export const NM_PER_LBFT = 1.3558179483;
export const KG_PER_LB = 0.45359237;

/** U+00A0 between number and unit, as everywhere (lib/units.ts). */
const NBSP = ' ';

const useUnitsStore = create<DisplayUnits & { chosen: boolean }>(() => ({ ...DEFAULT_UNITS, chosen: false }));

function pick<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((entry) => entry === value);
}

/** Applies the given units at once and keeps them on the device. Unknown values are ignored. */
export function setDisplayUnits(next: { distance?: unknown; torque?: unknown; weight?: unknown }): void {
  const current = useUnitsStore.getState();
  const units: DisplayUnits = {
    distance: pick(DISTANCE_UNITS, next.distance) ?? current.distance,
    torque: pick(TORQUE_UNITS, next.torque) ?? current.torque,
    weight: pick(WEIGHT_UNITS, next.weight) ?? current.weight,
  };
  useUnitsStore.setState({ ...units, chosen: true });
  void setStored('sc.units', JSON.stringify(units));
}

export function getDisplayUnits(): DisplayUnits {
  const { distance, torque, weight } = useUnitsStore.getState();
  return { distance, torque, weight };
}

export function useDisplayUnits(): DisplayUnits {
  const distance = useUnitsStore((state) => state.distance);
  const torque = useUnitsStore((state) => state.torque);
  const weight = useUnitsStore((state) => state.weight);
  return { distance, torque, weight };
}

/** The device's values at start; a choice made in the meantime wins. Never rejects. */
export async function hydrateDisplayUnits(): Promise<void> {
  const stored = await getStored('sc.units');
  if (!stored || useUnitsStore.getState().chosen) return;
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const current = useUnitsStore.getState();
    useUnitsStore.setState({
      distance: pick(DISTANCE_UNITS, parsed.distance) ?? current.distance,
      torque: pick(TORQUE_UNITS, parsed.torque) ?? current.torque,
      weight: pick(WEIGHT_UNITS, parsed.weight) ?? current.weight,
    });
  } catch {
    // A broken value keeps the defaults.
  }
}

void hydrateDisplayUnits();

/** "12.400 km" or "7.705 mi" from kilometres. */
export function formatDistance(km: number, unit: DistanceUnit = 'km', locale: FormatLocale = 'de'): string {
  const value = unit === 'mi' ? km / KM_PER_MILE : km;
  return `${formatNumber(roundInt(value), locale)}${NBSP}${unit}`;
}

/** "650 Nm" or "479 lb-ft" from newton metres. */
export function formatTorqueIn(nm: number, unit: TorqueUnit = 'nm', locale: FormatLocale = 'de'): string {
  return unit === 'lbft' ? `${formatNumber(roundInt(nm / NM_PER_LBFT), locale)}${NBSP}lb-ft` : `${formatNumber(roundInt(nm), locale)}${NBSP}Nm`;
}

/** "1.725 kg" or "3.803 lb" from kilograms. */
export function formatWeight(kg: number, unit: WeightUnit = 'kg', locale: FormatLocale = 'de'): string {
  const value = unit === 'lb' ? kg / KG_PER_LB : kg;
  return `${formatNumber(roundInt(value), locale)}${NBSP}${unit}`;
}
