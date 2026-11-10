import { createContext, use, type ReactNode } from 'react';

/** Interaction states a static screenshot cannot reach. */
export type ForcedVisualState = { pressed?: boolean; hovered?: boolean; focused?: boolean };

const ForcedVisualStateContext = createContext<ForcedVisualState | null>(null);

/**
 * Lets the component gallery (DEV-01) draw pressed, hover and focus without a real pointer. It compares
 * `process.env.EXPO_PUBLIC_APP_ENV` directly, so the minifier reduces this to `null` in production.
 */
export const useForcedVisualState: () => ForcedVisualState | null =
  process.env.EXPO_PUBLIC_APP_ENV === 'production' ? () => null : () => use(ForcedVisualStateContext);

export function ForcedVisualStateProvider({ value, children }: { value: ForcedVisualState; children: ReactNode }) {
  return <ForcedVisualStateContext value={value}>{children}</ForcedVisualStateContext>;
}

const EagerImagesContext = createContext(false);

/**
 * The gallery is one long specimen sheet and every photo on it is under review. A browser never loads a lazy image far
 * below the fold, and `decode()` on such an image stays pending. Also reduced to a constant in production.
 */
export const useEagerImages: () => boolean = process.env.EXPO_PUBLIC_APP_ENV === 'production' ? () => false : () => use(EagerImagesContext);

export function EagerImagesProvider({ children }: { children: ReactNode }) {
  return <EagerImagesContext value>{children}</EagerImagesContext>;
}

const NOTHING_FORCED: ForcedVisualState = {};

/**
 * Keeps a forced state on the one part of a composite that would really have it: the selected segment, the field and
 * not its clear button. `active` false passes the forced state through.
 */
export function WithoutForcedState({ active = true, children }: { active?: boolean; children: ReactNode }) {
  const forced = useForcedVisualState();
  return active && forced ? <ForcedVisualStateProvider value={NOTHING_FORCED}>{children}</ForcedVisualStateProvider> : children;
}
