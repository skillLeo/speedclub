import { Dimensions, PixelRatio, Platform } from 'react-native';

import { appVersionInfo } from '@/features/settings/version';
import i18n from '@/i18n';

import { api } from './client';

/** One report per error and route for the life of the app: a screen that fails on every render never floods the server. */
const sent = new Set<string>();

const cut = (value: string | undefined, max: number): string | undefined => (value ? value.slice(0, max) : undefined);

/**
 * Tells the server what broke when an error screen shows (POST /api/v1/client-errors, logged to storage/logs/client-*.log). The
 * route, the error and the device shape only: nothing the member typed. Fire and forget: a failed report is ignored.
 */
export function reportClientError(error: unknown, route: string, componentStack?: string | null): void {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  const key = `${route}|${err.name}|${err.message}`;
  if (sent.has(key)) return;
  sent.add(key);

  const { width, height } = Dimensions.get('window');
  const { version, build } = appVersionInfo();
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  const userAgent = platform === 'web' && typeof navigator !== 'undefined' ? navigator.userAgent : undefined;

  void api
    .POST('/client-errors', {
      body: {
        route: route.slice(0, 200) || '/',
        name: cut(err.name, 100),
        message: cut(err.message, 2000) || 'Unknown error',
        stack: cut(err.stack, 8000),
        component_stack: cut(componentStack ?? undefined, 8000),
        platform,
        app_version: cut(`${version} (${build})`, 40),
        locale: cut(i18n.language, 10),
        font_scale: Math.min(4, Math.max(0.5, PixelRatio.getFontScale())),
        viewport: `${Math.round(width)}x${Math.round(height)}@${PixelRatio.get().toFixed(3).replace(/\.?0+$/, '')}`,
        user_agent: cut(userAgent, 300),
      },
    })
    .catch(() => undefined);
}

/** For tests: forget which errors were sent. */
export function resetClientErrorReports(): void {
  sent.clear();
}
