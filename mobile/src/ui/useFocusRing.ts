import { useCallback, useState } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';

import { useForcedVisualState } from './qaVisualState';

const useStyles = createStyles((t) => ({
  ring: {
    outlineColor: t.color.focus.ring,
    outlineOffset: t.size.border.focusOffset,
    outlineStyle: 'solid',
    outlineWidth: t.size.border.focusRing,
  },
  ringOnPhoto: {
    outlineColor: t.color.onPhoto.primary,
    outlineOffset: t.size.border.focusOffset,
    outlineStyle: 'solid',
    outlineWidth: t.size.border.focusRing,
  },
  // DQ-054, ADR-161: a card has no inner padding, so its text and chips need more air before the ring than a shaped control does.
  // It reaches 6 outside the card: a scroller around cards needs that room (the profile strip of v1).
  ringCard: {
    outlineColor: t.color.focus.ring,
    outlineOffset: t.space[4],
    outlineStyle: 'solid',
    outlineWidth: t.size.border.focusRing,
  },
  // ADR-118: inside the shape, for a control whose parent clips or leaves no room for the outer offset.
  ringInset: {
    outlineColor: t.color.focus.ring,
    outlineOffset: -t.size.border.focusRing,
    outlineStyle: 'solid',
    outlineWidth: t.size.border.focusRing,
  },
}));

/**
 * For the element that holds focus but does not draw it. Style `none` and not width 0: Chromium paints its `auto` focus
 * ring whatever the width. Web only, because native outlines have no such value.
 */
export const NO_BROWSER_OUTLINE = (isWeb ? { outlineStyle: 'none' } : {}) as ViewStyle;

/**
 * DQ-038, DQ-197, for a single-line field: a placeholder or value too long for it ends in an ellipsis and not in a hard cut.
 * The name stays complete for screen readers. iOS does this by itself. At rest only: Chromium and WebKit both drop it on a
 * focused input, and no rule on `::placeholder` or `:placeholder-shown` brings it back (tried in both engines).
 */
export const FIELD_ELLIPSIS = (isWeb ? { textOverflow: 'ellipsis' } : {}) as TextStyle;

export type RingTone = 'default' | 'onPhoto' | 'inset' | 'card';

const RING_STYLE = { default: 'ring', onPhoto: 'ringOnPhoto', inset: 'ringInset', card: 'ringCard' } as const;

type FocusTarget = { matches?: (selector: string) => boolean };

/**
 * Keyboard focus on web (03_DESIGN_SYSTEM.md §5): 2 px ring + 2 px offset. The browser decides what counts as
 * keyboard focus through `:focus-visible`, so a mouse click never shows the ring. Native has no ring.
 */
export function useFocusRing(tone: RingTone = 'default') {
  const styles = useStyles();
  const forced = useForcedVisualState();
  const [keyboardFocused, setFocused] = useState(false);
  const focused = keyboardFocused || (forced?.focused ?? false);

  const onFocus = useCallback((event: { target?: unknown }) => {
    if (!isWeb) return;
    setFocused((event.target as FocusTarget | undefined)?.matches?.(':focus-visible') ?? false);
  }, []);
  const onBlur = useCallback(() => setFocused(false), []);

  return {
    focused,
    onFocus,
    onBlur,
    ringStyle: focused ? styles[RING_STYLE[tone]] : undefined,
  };
}
