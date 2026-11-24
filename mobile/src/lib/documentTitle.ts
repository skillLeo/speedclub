import { useEffect } from 'react';

import { isWeb } from '@/lib/platform';
import { useScreenFocused } from '@/ui/SkeletonFocus';

/** The product name in every browser title. */
const BRAND = 'Speedclub';

/** "Skyline GT-R R34 | Speedclub", or the product name alone for a screen without a title of its own. */
export function documentTitleFor(title: string | null | undefined): string {
  const own = title?.trim();
  return own ? `${own} | ${BRAND}` : BRAND;
}

/**
 * R4B-002 (client round 4 hunt): on the web the browser tab, the history entries, bookmarks and the share sheet kept the title of the
 * first page the server rendered (`Web/SpaController` writes the share head into index.html), however far the member navigated. The
 * header of the focused screen names the page now; a screen below it in the stack is not focused and leaves the title alone.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  const focused = useScreenFocused();
  useEffect(() => {
    if (!isWeb || !focused || typeof document === 'undefined') return;
    document.title = documentTitleFor(title);
  }, [focused, title]);
}
