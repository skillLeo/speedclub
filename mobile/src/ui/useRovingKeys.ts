import { useCallback, useRef, type ComponentRef } from 'react';
import type { View } from 'react-native';

type Host = ComponentRef<typeof View>;
type KeyEventLike = { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void };

export function keyOf(event: KeyEventLike): string | undefined {
  return event.key ?? event.nativeEvent?.key;
}

/**
 * Arrow-key navigation for a tablist or radiogroup on web: one tab stop, Left/Right/Home/End move and select.
 * Disabled entries are skipped.
 */
export function useRovingKeys(
  enabled: readonly boolean[],
  selectedIndex: number,
  onSelect: (index: number) => void,
) {
  const refs = useRef<(Host | null)[]>([]);

  const setRef = useCallback(
    (index: number) => (node: Host | null) => {
      refs.current[index] = node;
    },
    [],
  );

  const onKeyDown = (event: KeyEventLike) => {
    const count = enabled.length;
    const key = keyOf(event);
    const walk = (from: number, delta: number) => {
      let next = from;
      for (let i = 0; i < count; i += 1) {
        next = (next + delta + count) % count;
        if (enabled[next]) return next;
      }
      return from;
    };
    let target: number | undefined;
    if (key === 'ArrowRight') target = walk(selectedIndex, 1);
    else if (key === 'ArrowLeft') target = walk(selectedIndex, -1);
    else if (key === 'Home') target = walk(-1, 1);
    else if (key === 'End') target = walk(count, -1);
    if (target === undefined) return;
    event.preventDefault?.();
    if (target !== selectedIndex) onSelect(target);
    refs.current[target]?.focus?.();
  };

  return { setRef, onKeyDown };
}
