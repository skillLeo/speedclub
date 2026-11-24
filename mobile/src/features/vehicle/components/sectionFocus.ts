import { createContext, use, useCallback, useMemo, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { isWeb } from '@/lib/platform';

import type { ProfileSection } from '../sections';

/** The sections' headings as they mount and unmount (virtualised rows), for moving focus to one after a jump. */
export type SectionHeadings = {
  register: (section: ProfileSection, node: unknown) => void;
  focus: (section: ProfileSection) => boolean;
};

export const SectionHeadingsContext = createContext<SectionHeadings | null>(null);

type WebNode = { focus: (options?: { preventScroll?: boolean }) => void; setAttribute: (name: string, value: string) => void; hasAttribute: (name: string) => boolean };

function isWebNode(value: unknown): value is WebNode {
  return typeof value === 'object' && value !== null && 'focus' in value && 'setAttribute' in value;
}

/**
 * Review SF-4 (WCAG 2.4.3): an in-page link moves focus to its target. On web the heading takes focus without scrolling again
 * (`tabindex=-1`, so it is reachable by script only); on native the screen reader's cursor moves to it.
 */
export function useSectionHeadings(): SectionHeadings {
  const nodes = useRef(new Map<ProfileSection, unknown>());
  const register = useCallback((section: ProfileSection, node: unknown) => {
    if (node) nodes.current.set(section, node);
    else nodes.current.delete(section);
  }, []);
  const focus = useCallback((section: ProfileSection) => {
    const node = nodes.current.get(section);
    if (!node) return false;
    if (isWeb) {
      if (!isWebNode(node)) return false;
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
      return true;
    }
    AccessibilityInfo.sendAccessibilityEvent(node as Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0], 'focus');
    return true;
  }, []);
  return useMemo(() => ({ register, focus }), [focus, register]);
}

/** The ref callback of a section heading. */
export function useHeadingRef(section: ProfileSection | undefined): ((node: unknown) => void) | undefined {
  const headings = use(SectionHeadingsContext);
  const register = headings?.register;
  return useCallback(
    (node: unknown) => {
      if (section && register) register(section, node);
    },
    [register, section],
  );
}
