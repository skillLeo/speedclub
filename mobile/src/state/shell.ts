/** Small UI state of the navigation shell. */
import { create } from 'zustand';

type ShellState = {
  /** A focused editor asked for the tab bar to go away (§9: hidden in editors). */
  tabBarHidden: boolean;
};

export const useShellStore = create<ShellState>(() => ({ tabBarHidden: false }));

export function setTabBarHidden(tabBarHidden: boolean): void {
  useShellStore.setState({ tabBarHidden });
}
