/**
 * QA overrides (07_QA_AND_RELEASE.md §3). Read once from the URL at web startup and kept for the
 * session, so in-app navigation keeps them. Native builds have no URL at startup and get none.
 *
 * The production checks must keep comparing `process.env.EXPO_PUBLIC_APP_ENV` directly:
 * the Expo preset inlines that exact expression, and the minifier then removes the parser and its
 * parameter names from the bundle. mobile/tests/qa.test.ts guards the wiring.
 */
import type { ThemePreference } from '@/theme/tokens.generated';

export type QaState = 'default' | 'loading' | 'empty' | 'error' | 'offline' | 'restricted';

export type QaOverrides = {
  readonly theme?: ThemePreference;
  readonly locale?: 'de' | 'en';
  readonly fontScale?: number;
  readonly state?: QaState;
  readonly motion?: 'off';
  readonly now?: Date;
  /**
   * `qaOpen=report`: the page's report sheet (M2.6) opens by itself once its target is there, so the visual matrix, which cannot
   * tap, captures it (PROF-02, VEH-01). Not part of the reported overrides on <html>.
   */
  readonly open?: 'report';
  /**
   * `qaFlags=ai.nl_search,ai.translate`: these app-config flags count as on, and an AI surface they switch on needs no opt-in, so the
   * visual matrix can capture the [AI] surfaces on a host without a provider (where no `ai.*` flag can be on, ADR-242). What a tap then
   * asks still meets the server's 404 `feature_disabled`.
   */
  readonly flags?: readonly string[];
};

/** A flag key as app-config names them ("ai.nl_search"); at most this many in one override. */
const QA_FLAG = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const QA_FLAGS_MAX = 12;

const NO_OVERRIDES: QaOverrides = Object.freeze({});

export const parseQa: (search: string) => QaOverrides =
  process.env.EXPO_PUBLIC_APP_ENV === 'production'
    ? () => NO_OVERRIDES
    : (search) => {
        const params = new URLSearchParams(search);
        const theme = params.get('qaTheme');
        const locale = params.get('qaLocale');
        const fontScale = Number(params.get('qaFontScale'));
        const state = params.get('qaState');
        const now = new Date(params.get('qaNow') ?? Number.NaN);
        const flags = (params.get('qaFlags') ?? '')
          .split(',')
          .map((flag) => flag.trim())
          .filter((flag) => QA_FLAG.test(flag))
          .slice(0, QA_FLAGS_MAX);
        return {
          ...(theme === 'carbon' || theme === 'black' || theme === 'light' || theme === 'system' ? { theme } : {}),
          ...(locale === 'de' || locale === 'en' ? { locale } : {}),
          ...(fontScale >= 0.5 && fontScale <= 4 ? { fontScale } : {}),
          ...(state === 'default' ||
          state === 'loading' ||
          state === 'empty' ||
          state === 'error' ||
          state === 'offline' ||
          state === 'restricted'
            ? { state }
            : {}),
          ...(params.get('qaMotion') === 'off' ? { motion: 'off' as const } : {}),
          ...(params.get('qaOpen') === 'report' ? { open: 'report' as const } : {}),
          ...(Number.isNaN(now.getTime()) ? {} : { now }),
          ...(flags.length > 0 ? { flags } : {}),
        };
      };

function readOverrides(): QaOverrides {
  if (process.env.EXPO_PUBLIC_APP_ENV === 'production') return NO_OVERRIDES;
  const search = typeof window === 'undefined' ? undefined : window.location?.search;
  return search ? parseQa(search) : NO_OVERRIDES;
}

export const qa: QaOverrides = readOverrides();

/** Whether `qaFlags` forces this app-config flag on (never in production, where `qa` has no overrides). */
export function qaForcesFlag(key: string): boolean {
  return qa.flags?.includes(key) === true;
}

/** The forced screen state for feature screens; `default` means render real data. */
export function useQaState(): QaState {
  return qa.state ?? 'default';
}
