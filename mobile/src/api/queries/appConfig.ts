/**
 * Runtime config (05_ARCHITECTURE.md §12): polled on start and every 5 minutes in the foreground, ETag aware. The last
 * good copy lives in AsyncStorage and bundled defaults cover a first launch without network, so this query never
 * fails and nothing ever waits for it. A payload that does not match the schema is ignored.
 *
 * A cached maintenance flag only counts while the request is under way or when the server backs it with a 423 or 5xx.
 * Without such an answer it is lifted: the app must stay usable offline, and it could not recheck from the gate anyway.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { z } from 'zod';

import { api, onApiGateEvent } from '@/api/client';
import { previewToken } from '@/api/preview';
import { qaForcesFlag } from '@/lib/qa';
import { queryClient } from '@/api/queryClient';
import type { components } from '@/api/schema';

export type AppConfig = components['schemas']['AppConfigResource'];
export type Announcement = AppConfig['announcements'][number];
export type BrandHero = NonNullable<NonNullable<AppConfig['branding']['heroes']>['welcome']>;

const nullableString = z.string().nullable();
const platformVersions = z.object({ ios: z.string(), android: z.string() });
/** A brand photo of ADM-28: WebP variants smallest first, blurhash and the focal point 0–1. Null keeps the bundled photo. */
const brandHero = z
  .object({
    url: nullableString,
    variants: z.array(z.object({ width: z.number(), url: z.string() })),
    width: z.number(),
    height: z.number(),
    blurhash: nullableString,
    focal_x: z.number().min(0).max(1),
    focal_y: z.number().min(0).max(1),
  })
  .nullable();

/** A logo's intrinsic size in px (M3.5 ADM-28). Anything but two positive numbers: null. */
const logoSize = z
  .object({ width: z.number(), height: z.number() })
  .nullable()
  .catch(null)
  .transform((size) => (size && size.width > 0 && size.height > 0 && Number.isFinite(size.width / size.height) ? size : null));

export const appConfigSchema: z.ZodType<AppConfig> = z.object({
  min_version: platformVersions,
  latest_version: platformVersions,
  // M3.5 (ADM-37, ADM-31): a config cached by an older build has neither; the bundled force-update text and no re-consent apply.
  force_update_message: nullableString.default(null),
  maintenance: z.object({ enabled: z.boolean(), message: nullableString }),
  flags: z.record(z.string(), z.boolean()),
  branding: z.object({
    logo: nullableString,
    splash_image: nullableString,
    welcome_hero: nullableString,
    accent_set: z.string(),
    default_theme: z.string(),
    // M3.5 ADM-28: the logo set, the hero photos with focal point, the OG default. Absent from a config cached by an older build:
    // every brand surface keeps its bundled file then.
    logos: z
      .object({ wordmark_white: nullableString, wordmark_black: nullableString, square: nullableString, app_mark: nullableString })
      .optional(),
    // Each logo's intrinsic size, so a custom wordmark keeps its aspect ratio. A slot without a logo, or a size that is no real size,
    // reads as null: that logo is then not drawn from the server.
    logo_sizes: z
      .object({ wordmark_white: logoSize, wordmark_black: logoSize, square: logoSize, app_mark: logoSize })
      .optional(),
    heroes: z.object({ welcome: brandHero, landing: brandHero, splash: brandHero }).optional(),
    og_default: nullableString.optional(),
  }),
  announcements: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      severity: z.string(),
      link: nullableString,
      // M3.5 ADM-30.
      cta_label: nullableString.optional(),
      audience: z.enum(['all', 'new', 'with_vehicles']).optional(),
      dismissible: z.boolean().optional(),
      starts_at: nullableString.optional(),
      ends_at: nullableString.optional(),
    }),
  ),
  legal_versions: z.record(z.string(), nullableString),
  legal_reconsent: z.object({ terms: nullableString, privacy: nullableString }).default({ terms: null, privacy: null }),
  links: z.record(z.string(), nullableString),
  // M2.4: Pusher's public values. A config cached by an older build has none: realtime is then off and the app polls.
  realtime: z.object({ enabled: z.boolean(), key: nullableString, cluster: nullableString }).default({ enabled: false, key: null, cluster: null }),
});

/** Nothing blocked, no flag on. What a first launch without network runs on. */
export const BUNDLED_APP_CONFIG: AppConfig = {
  min_version: { ios: '0.0.0', android: '0.0.0' },
  latest_version: { ios: '0.0.0', android: '0.0.0' },
  force_update_message: null,
  maintenance: { enabled: false, message: null },
  flags: {},
  branding: { logo: null, splash_image: null, welcome_hero: null, accent_set: 'default', default_theme: 'system' },
  announcements: [],
  legal_versions: {},
  legal_reconsent: { terms: null, privacy: null },
  links: {},
  realtime: { enabled: false, key: null, cluster: null },
};

export const APP_CONFIG_STORAGE_KEY = 'sc.appConfig';
export const APP_CONFIG_POLL_MS = 5 * 60 * 1000;
export const APP_CONFIG_GATE_REFETCH_MS = 30 * 1000;
/** A connection that hangs instead of failing, such as a captive portal, counts as no answer after this long. */
export const APP_CONFIG_TIMEOUT_MS = 10 * 1000;
export const appConfigKey = ['app-config'] as const;

/**
 * `confirmed`: the server vouched for this config with a valid 200 or a 304. Only then may it undo a gate, since a
 * bundled or cached copy proves nothing about the present. Both travel in one value, so no render sees one without
 * the other.
 *
 * `released`: a cached maintenance flag was lifted because nothing backs it. That undoes the maintenance gate without
 * proving anything about the server, so a gate route is left even though `confirmed` stays false.
 */
export type AppConfigState = { config: AppConfig; confirmed: boolean; released?: true };

type CachedConfig = { etag: string | null; config: AppConfig };

const cacheSchema = z.object({ etag: z.string().nullable(), config: appConfigSchema });

export async function readCachedConfig(): Promise<CachedConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(APP_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = cacheSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeCachedConfig(cached: CachedConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(cached));
  } catch (error) {
    console.warn('Could not store the app config', error);
  }
}

/** The config when no answer backs a cached maintenance flag. */
function withoutVerdict(config: AppConfig): AppConfigState {
  if (!config.maintenance.enabled) return { config, confirmed: false };
  return { config: { ...config, maintenance: { ...config.maintenance, enabled: false } }, confirmed: false, released: true };
}

/** Never rejects. The newest usable config wins: fresh, then the last good one, then the bundled defaults. */
export async function loadAppConfig(): Promise<AppConfigState> {
  const cached = await readCachedConfig();
  // The cached copy applies right away, so a known maintenance window does not wait for the network. Only on the first
  // load: later polls keep what the last one settled on, or every poll offline would flash the maintenance screen.
  if (cached && !queryClient.getQueryState(appConfigKey)?.dataUpdatedAt) {
    queryClient.setQueryData<AppConfigState>(appConfigKey, { config: cached.config, confirmed: false });
  }
  const fallback = cached?.config ?? BUNDLED_APP_CONFIG;
  const unconfirmed: AppConfigState = { config: fallback, confirmed: false };
  const unbacked = withoutVerdict(fallback);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The race also ends the wait for a transport that ignores the signal.
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('The app config request timed out'));
    }, APP_CONFIG_TIMEOUT_MS);
  });
  try {
    const { data, response } = await Promise.race([
      api.GET('/app-config', {
        // A preview's answer overlays drafts: the published ETag must not turn it into a 304 of the live config.
        headers: cached?.etag && !previewToken() ? { 'If-None-Match': cached.etag } : {},
        signal: controller.signal,
      }),
      timedOut,
    ]);
    if (response.status === 304) return { config: fallback, confirmed: true };
    // The server is there and in trouble, which is what a maintenance window looks like from here.
    if (response.status === 423 || response.status >= 500) return unconfirmed;
    if (!response.ok || !data) return unbacked;
    const parsed = appConfigSchema.safeParse(data.data);
    if (!parsed.success) {
      console.warn('Ignoring an app config that does not match the schema');
      return unbacked;
    }
    // A draft preview (ADM-34) never becomes the config this browser starts with next time.
    if (!previewToken()) await writeCachedConfig({ etag: response.headers.get('ETag'), config: parsed.data });
    return { config: parsed.data, confirmed: true };
  } catch {
    return unbacked;
  } finally {
    clearTimeout(timer);
  }
}

/** The current config, available from the first render. */
export function useAppConfig() {
  const query = useQuery({
    queryKey: appConfigKey,
    queryFn: loadAppConfig,
    initialData: { config: BUNDLED_APP_CONFIG, confirmed: false },
    // Marks the bundled copy as old, so the first mount fetches.
    initialDataUpdatedAt: 0,
    staleTime: APP_CONFIG_POLL_MS,
    refetchInterval: APP_CONFIG_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    // Stored separately, together with its ETag.
    meta: { persist: false },
  });
  const { refetch } = query;

  // The API says maintenance or upgrade before the next poll would. During an outage every call answers like that, so
  // a config that is still young stands, and a request already under way is joined instead of restarted.
  useEffect(
    () =>
      onApiGateEvent((event) => {
        if (event !== 'maintenance' && event !== 'upgrade') return;
        const age = Date.now() - (queryClient.getQueryState(appConfigKey)?.dataUpdatedAt ?? 0);
        if (age >= APP_CONFIG_GATE_REFETCH_MS) void refetch({ cancelRefetch: false });
      }),
    [refetch],
  );

  const { config, confirmed, released = false } = query.data;
  return { config, confirmed, released, refetch, isFetching: query.isFetching };
}

/** Numeric, part by part: 1.10.0 is newer than 1.9.9. Anything unreadable counts as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export type AppGate = 'update-required' | 'maintenance' | null;

/**
 * What the config demands of this build. An update comes first, because only the user can resolve it. The web always
 * ships with the server, so it has no minimum version.
 */
export function appGateFor(config: AppConfig, platform: string, appVersion: string): AppGate {
  if (platform === 'ios' || platform === 'android') {
    if (compareVersions(appVersion, config.min_version[platform]) < 0) return 'update-required';
  }
  return config.maintenance.enabled ? 'maintenance' : null;
}

/**
 * A feature flag of app-config (`sig.*`, `ai.*`). Off until the server says otherwise, so a first launch without network shows no
 * extra. It only reads: the gate in the root layout loads and polls the config, a screen asking for a flag sends nothing.
 */
export function useFlag(key: string): boolean {
  const query = useQuery({
    queryKey: appConfigKey,
    queryFn: loadAppConfig,
    initialData: { config: BUNDLED_APP_CONFIG, confirmed: false },
    initialDataUpdatedAt: 0,
    enabled: false,
    meta: { persist: false },
  });
  return query.data.config.flags[key] === true || qaForcesFlag(key);
}
