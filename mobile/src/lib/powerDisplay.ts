/**
 * SET-11 power display for every screen (§3.9): "PS (kW)" until the device or the account says otherwise. A small store, so
 * `useFormat().power` follows the choice without a query provider. The device keeps the last value (`sc.powerDisplay`), which
 * the start applies before the account answers; a sign-in, the settings and SET-11 set it from the account.
 */
import { create } from 'zustand';

import { getStored, setStored } from './storage';
import type { PowerDisplay } from './units';

export const POWER_DISPLAYS: readonly PowerDisplay[] = ['ps_kw', 'kw_ps', 'hp'];
export const DEFAULT_POWER_DISPLAY: PowerDisplay = 'ps_kw';

export function asPowerDisplay(value: unknown): PowerDisplay | null {
  return POWER_DISPLAYS.find((display) => display === value) ?? null;
}

const usePowerDisplayStore = create<{ display: PowerDisplay; chosen: boolean }>(() => ({ display: DEFAULT_POWER_DISPLAY, chosen: false }));

/** Applies a display at once and keeps it on the device. Unknown values are ignored. */
export function setPowerDisplay(value: unknown): void {
  const display = asPowerDisplay(value);
  if (!display) return;
  if (usePowerDisplayStore.getState().display !== display) usePowerDisplayStore.setState({ display, chosen: true });
  else usePowerDisplayStore.setState({ chosen: true });
  void setStored('sc.powerDisplay', display);
}

export function getPowerDisplay(): PowerDisplay {
  return usePowerDisplayStore.getState().display;
}

export function usePowerDisplayPreference(): PowerDisplay {
  return usePowerDisplayStore((state) => state.display);
}

/** The device's value at start; a choice made in the meantime wins. Never rejects. */
export async function hydratePowerDisplay(): Promise<void> {
  const stored = asPowerDisplay(await getStored('sc.powerDisplay'));
  if (stored && !usePowerDisplayStore.getState().chosen) usePowerDisplayStore.setState({ display: stored });
}

void hydratePowerDisplay();
