import { useTranslation } from 'react-i18next';

import { useViewAsStore, type ViewAsState } from './viewAsSession';

/** The view-as statuses in which the app runs as the member, read-only. */
const LIVE: ReadonlySet<ViewAsState['status']> = new Set(['starting', 'active', 'failed', 'ending']);

/**
 * Whether this tab is a read-only view as a member (m3.2-contract §3). Write controls are disabled while it is true, with
 * `auth:viewAs.readOnly` or the page's notice as the reason; the API client refuses the write anyway. Always false on native.
 */
export function useViewAsReadOnly(): boolean {
  return useViewAsStore((state) => LIVE.has(state.status));
}

/**
 * The `locked` reason of a write control (Button, IconButton, HeaderAction, StickyCTABar) in a read-only view as a member (M3.5
 * view-as leftovers): the control looks disabled and a press says why, instead of a refusal after the tap. Null in any other tab.
 * `messages` for controls that lead into messaging, which view-as never opens (ADR-227).
 */
export function useViewAsLock(kind: 'write' | 'messages' = 'write'): string | null {
  const { t } = useTranslation('auth');
  const readOnly = useViewAsReadOnly();
  if (!readOnly) return null;
  return kind === 'messages' ? t('viewAs.noMessages') : t('viewAs.readOnly');
}
