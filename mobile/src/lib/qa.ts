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
   * tap, captures it (PROF-02, VEH-01). `qaOpen=actions`: MSG-02 opens the actions sheet of the newest received text message once
   * the thread has loaded (MSG-02-translate), as the matrix cannot long-press. `qaOpen=installHint`: the member web's install hint
   * (M4.15, features/pwa/installHint.ts) shows even in an automated browser, which otherwise never gets it. M5.9a: `qaOpen=plateCheck`
   * opens GAR-01's "Kennzeichen prüfen" sheet once the card shows; `qaOpen=plateBlur` opens GAR-07's plate blur editor on the
   * vehicle's first photo (nothing is uploaded from it). Not part of the reported overrides on <html>.
   */
  readonly open?: 'report' | 'actions' | 'installHint' | 'plateCheck' | 'plateBlur';
  /**
   * `qaFlags=ai.nl_search,ai.translate`: these app-config flags count as on, and an AI surface they switch on needs no opt-in, so the
   * visual matrix can capture the [AI] surfaces on a host without a provider (where no `ai.*` flag can be on, ADR-242). What a tap then
   * asks still meets the server's 404 `feature_disabled`.
   */
  readonly flags?: readonly string[];
  /**
   * DQ-1162: `qaPush=off|on|denied|needsInstall|unsupported|unavailable` shows SET-09's "In diesem Browser" row in that state on the
   * member web while `web_push` is on, without a VAPID key or a real permission prompt (an automated browser has neither).
   */
  readonly push?: QaPushState;
  /** DQ-1151: `qaStep=2…5` opens BIZ-02's wizard on that step, so the matrix captures steps it cannot fill its way to. */
  readonly step?: number;
  /**
   * M5.9b: `qaDex=new|duplicate|first|ghost|young` shows DEX-03 (`/dex/spot/sample`) with the bundled sample spot in that variant
   * (NEU, "Schon in deinem Dex", First Spotter foil, Ghost frame, "Dein Konto ist noch neu"), so the matrix can capture the reveal
   * before the server has spots. Nothing is sent. Part 2: any `qaDex` value also answers the Dex reads (DEX-01, -04, -05, -06, the
   * owner line on VEH-01 and the spot map layer) from the bundled QA set (features/dex/qaDex.ts); `qaDex=sample` is that set alone.
   * DQ-P5G-13: `qaDex=live` on `/dex/spot/{slug}` shows the reveal of a real public car (its page and its Dex card, read as the
   * signed-in member), so the matrix captures Folgen · Reaktion senden · Zum Dex; the reveal's "NEU" line is the QA part.
   */
  readonly dex?: QaDex;
  /**
   * M5.9c: `qaScore=sample|pending|error|<0–1000>` answers the Build Score reads (VEH-01 section, the formula sheet, GAR-01's compact
   * score) from the bundled QA set (features/score/qaScore.ts) until lane B serves them: `sample` a stage 4 build with both ranks and a
   * "+25", a number that total (the stage follows), `pending` "wird berechnet", `error` the section's error state. Nothing is sent.
   */
  readonly score?: QaScore;
  /**
   * M5.9d: `qaGift=sample|unlock|stack|owner|error` answers the supporting-system reads (level, badges, Car of the Day, invites, the
   * invite lookup of `/join/{code}`) from the bundled, "Beispiel"-badged set in features/gift/qaGift.ts until lane B serves them:
   * `sample` the set alone, `unlock` one unseen badge (the unlock toast), `stack` three ("3 neue Abzeichen"), `owner` Car of the Day
   * of the signed-in member's own car (the story editor), `error` every gift read fails. Nothing is sent.
   */
  readonly gift?: QaGift;
  /**
   * M5.9e: `qaWrapped=sample|countdown|empty|error` answers the Season Wrapped reads (WRP-01, the PROF-01 row, the Home countdown)
   * from the bundled, "Beispiel"-badged set in features/wrapped/qaWrapped.ts until lane B serves them: `sample` a released
   * `2026-saison` with all nine cards, `countdown` that season three days before its release (the Home banner; WRP-01 "noch nicht
   * veröffentlicht"), `empty` no Wrapped for this member, `error` every read fails. With `card=n` WRP-01 opens on card n and holds
   * it (paused), so the matrix captures one card per cell. Nothing is sent.
   */
  readonly wrapped?: QaWrapped;
  /**
   * M5.4: `qaStickers=sample` answers the sticker scan counts (STK-01's "diese Woche", STK-04's 30 days, totals, first scan) from the
   * bundled, "Beispiel"-badged set in features/qr/qaStickers.ts, so the matrix captures a sticker with scans on a host whose demo cars
   * have none. Designs, previews, the Scan-Test and the order link stay real. Nothing is sent from the sample.
   */
  readonly stickers?: QaStickers;
  /**
   * M5.4 design QA DQ-M54-07: `qaDesigner=expanded|qroff|line|minimal|banner|plate|vertical|round` opens STK-05 with the dock expanded,
   * the QR code off (its warning), a custom line, or another template, so the matrix captures the editing states it cannot tap to.
   * Preview only: the designer saves nothing while it is set.
   */
  readonly designer?: QaDesigner;
};

export const QA_DESIGNER_VARIANTS = ['expanded', 'qroff', 'line', 'minimal', 'banner', 'plate', 'vertical', 'round'] as const;
export type QaDesigner = (typeof QA_DESIGNER_VARIANTS)[number];

export const QA_STICKER_VARIANTS = ['sample'] as const;
export type QaStickers = (typeof QA_STICKER_VARIANTS)[number];

export const QA_WRAPPED_VARIANTS = ['sample', 'countdown', 'empty', 'error'] as const;
export type QaWrapped = (typeof QA_WRAPPED_VARIANTS)[number];

export const QA_GIFT_VARIANTS = ['sample', 'unlock', 'stack', 'owner', 'error'] as const;
export type QaGift = (typeof QA_GIFT_VARIANTS)[number];

export const QA_SCORE_WORDS = ['sample', 'pending', 'error'] as const;
export type QaScore = (typeof QA_SCORE_WORDS)[number] | number;

/** `qaScore` as the override takes it: one of the words, or a whole number 0–1000. */
export function parseQaScore(raw: string | null): QaScore | undefined {
  if (raw === null) return undefined;
  if ((QA_SCORE_WORDS as readonly string[]).includes(raw)) return raw as QaScore;
  if (!/^\d{1,4}$/.test(raw)) return undefined;
  const value = Number(raw);
  return value <= 1000 ? value : undefined;
}

export const QA_DEX_VARIANTS = ['new', 'duplicate', 'first', 'ghost', 'young', 'sample', 'live'] as const;
export type QaDex = (typeof QA_DEX_VARIANTS)[number];

export const QA_PUSH_STATES = ['off', 'on', 'denied', 'needsInstall', 'unsupported', 'unavailable'] as const;
export type QaPushState = (typeof QA_PUSH_STATES)[number];
const QA_STEP_MAX = 9;

/** A flag key as app-config names them ("ai.nl_search"); at most this many in one override. */
const QA_FLAG = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/**
 * M4.15: the off-by-default product flags without a dot whose screens the matrix and the e2e specs must still reach (MEM-01 / SET-24
 * `membership`, the QR-02 shop link `sticker_shop`, SET-09's browser row `web_push`). M4.14: `parts_catalogue` (BRD-01/02, the Teile
 * scope, the mod editor's product search) and `businesses` (BIZ-01…04, the Betriebe scope, "Eingebaut von"). Named one by one, so no
 * other bare key counts.
 */
// Client round 4: the visual matrix reaches Car of the Day voting, comments and Crews through `qaFlags` too.
const QA_PLAIN_FLAGS: ReadonlySet<string> = new Set(['membership', 'sticker_shop', 'web_push', 'parts_catalogue', 'businesses', 'cotd_voting', 'build_comments', 'crews']);
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
        const push = params.get('qaPush');
        const step = Number(params.get('qaStep'));
        const dex = params.get('qaDex');
        const score = parseQaScore(params.get('qaScore'));
        const gift = params.get('qaGift');
        const wrapped = params.get('qaWrapped');
        const stickers = params.get('qaStickers');
        const designer = params.get('qaDesigner');
        const flags = (params.get('qaFlags') ?? '')
          .split(',')
          .map((flag) => flag.trim())
          .filter((flag) => QA_FLAG.test(flag) || QA_PLAIN_FLAGS.has(flag))
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
          ...(params.get('qaOpen') === 'actions' ? { open: 'actions' as const } : {}),
          ...(params.get('qaOpen') === 'installHint' ? { open: 'installHint' as const } : {}),
          ...(params.get('qaOpen') === 'plateCheck' ? { open: 'plateCheck' as const } : {}),
          ...(params.get('qaOpen') === 'plateBlur' ? { open: 'plateBlur' as const } : {}),
          ...(Number.isNaN(now.getTime()) ? {} : { now }),
          ...(flags.length > 0 ? { flags } : {}),
          ...((QA_PUSH_STATES as readonly string[]).includes(push ?? '') ? { push: push as QaPushState } : {}),
          ...(Number.isInteger(step) && step >= 1 && step <= QA_STEP_MAX ? { step } : {}),
          ...((QA_DEX_VARIANTS as readonly string[]).includes(dex ?? '') ? { dex: dex as QaDex } : {}),
          ...(score !== undefined ? { score } : {}),
          ...((QA_GIFT_VARIANTS as readonly string[]).includes(gift ?? '') ? { gift: gift as QaGift } : {}),
          ...((QA_WRAPPED_VARIANTS as readonly string[]).includes(wrapped ?? '') ? { wrapped: wrapped as QaWrapped } : {}),
          ...((QA_STICKER_VARIANTS as readonly string[]).includes(stickers ?? '') ? { stickers: stickers as QaStickers } : {}),
          ...((QA_DESIGNER_VARIANTS as readonly string[]).includes(designer ?? '') ? { designer: designer as QaDesigner } : {}),
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
