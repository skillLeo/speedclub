import '@/features/parts/i18n';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { errorMessageOf } from '@/features/home/components/BrowseStates';
import type { QaState } from '@/lib/qa';
import { EmptyState, ErrorState, type IconName } from '@/ui';

export type PageState = 'off' | 'loading' | 'notFound' | 'error' | 'offline' | 'ready';

type QueryLike = { data: unknown; error: unknown; fetchStatus: 'fetching' | 'paused' | 'idle' };

/**
 * The route contract (§8) of the parts and business pages: a forced QA state first (the visual matrix), then the flag (off: the
 * calm "not available" state, nothing asked), a 404 (gone, private, a business not verified yet), data (offline with a copy stays
 * ready under the shell's banner), an error, offline without a copy, else loading.
 */
export function pageStateOf(query: QueryLike, flag: boolean, online: boolean, qaState: QaState): PageState {
  if (qaState === 'loading') return 'loading';
  if (qaState === 'error') return 'error';
  if (qaState === 'empty') return 'notFound';
  if (!flag) return 'off';
  if (query.error instanceof ApiError && query.error.kind === 'not_found') return 'notFound';
  if (query.data !== undefined) return 'ready';
  if (query.error) return online ? 'error' : 'offline';
  if (query.fetchStatus === 'paused') return 'offline';
  return 'loading';
}

export type PageStateBodyProps = {
  state: Exclude<PageState, 'loading' | 'ready'>;
  routeId: string;
  /** The glyph of the off and not-found states: `part-box` for parts, `workshop` for businesses. */
  icon: IconName;
  /** Which flag is off, for its words. */
  area: 'parts' | 'businesses';
  notFound: { title: string; body: string; preview?: ReactNode; actionLabel: string; onAction: () => void };
  errorTitle: string;
  error?: unknown;
  onRetry: () => void;
  retrying: boolean;
};

/** The body of a page that has nothing to show yet: off, not found (with a sample preview), error with retry, offline. */
export function PageStateBody({ state, routeId, icon, area, notFound, errorTitle, error, onRetry, retrying }: PageStateBodyProps) {
  const { t } = useTranslation('parts');
  if (state === 'off') {
    return <EmptyState icon={icon} title={t(`off.${area}Title`)} body={t(`off.${area}Body`)} testID={`${routeId}.unavailable`} />;
  }
  if (state === 'notFound') {
    return (
      <EmptyState
        icon={notFound.preview ? undefined : icon}
        preview={notFound.preview}
        title={notFound.title}
        body={notFound.body}
        action={{ label: notFound.actionLabel, onPress: notFound.onAction, variant: 'secondary', size: 'm' }}
        testID={`${routeId}.notFound`}
      />
    );
  }
  const offline = state === 'offline';
  return (
    <ErrorState
      title={offline ? t('states.offlineTitle') : errorTitle}
      message={offline ? t('states.offlineBody') : (errorMessageOf(error) ?? t('states.errorBody'))}
      onRetry={onRetry}
      retrying={retrying}
      testID={`${routeId}.${offline ? 'offline' : 'error'}`}
    />
  );
}
