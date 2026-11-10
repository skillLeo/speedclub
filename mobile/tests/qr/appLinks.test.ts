/* eslint-disable @typescript-eslint/no-require-imports */
import type { ExpoConfig } from 'expo/config';

/** app.config.ts as the build evaluates it, with this environment. */
function configFor(env: Record<string, string | undefined>): ExpoConfig {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      config = (require('../../app.config') as { default: ExpoConfig }).default;
    });
    return config!;
  } finally {
    process.env = saved;
  }
}

const WEB = 'https://speedclub.de';

describe('App Links and universal links (M1.7, M2.1)', () => {
  it.each(['staging', 'production'])('%s: verified https links for /c, /C, /v and /u on the build’s own host', (appEnv) => {
    const config = configFor({ EXPO_PUBLIC_APP_ENV: appEnv, EXPO_PUBLIC_WEB_URL: WEB });
    expect(config.android?.intentFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'speedclub.de', pathPrefix: '/c/' },
          { scheme: 'https', host: 'speedclub.de', pathPrefix: '/C/' },
          { scheme: 'https', host: 'speedclub.de', pathPrefix: '/v/' },
          { scheme: 'https', host: 'speedclub.de', pathPrefix: '/u/' },
          { scheme: 'https', host: 'speedclub.de', path: '/app/reset-password' },
          { scheme: 'https', host: 'speedclub.de', path: '/app/verify-email' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
    expect(config.ios?.associatedDomains).toEqual(['applinks:speedclub.de']);
    // The scheme stays for every build.
    expect(config.scheme).toBe('speedclub');
  });

  it('takes the host of a staging subdomain, lowercased, and a port when the URL has one', () => {
    const config = configFor({ EXPO_PUBLIC_APP_ENV: 'staging', EXPO_PUBLIC_WEB_URL: 'https://Staging.SpeedClub.de:8443/' });
    const data = config.android?.intentFilters?.[0]?.data;
    expect(data).toEqual([
      { scheme: 'https', host: 'staging.speedclub.de', port: '8443', pathPrefix: '/c/' },
      { scheme: 'https', host: 'staging.speedclub.de', port: '8443', pathPrefix: '/C/' },
      { scheme: 'https', host: 'staging.speedclub.de', port: '8443', pathPrefix: '/v/' },
      { scheme: 'https', host: 'staging.speedclub.de', port: '8443', pathPrefix: '/u/' },
      { scheme: 'https', host: 'staging.speedclub.de', port: '8443', path: '/app/reset-password' },
      { scheme: 'https', host: 'staging.speedclub.de', port: '8443', path: '/app/verify-email' },
    ]);
    expect(config.ios?.associatedDomains).toEqual(['applinks:staging.speedclub.de:8443']);
  });

  it('claims /u/ with PROF-02, and never a prefix that would take /community-richtlinien or another /u… page', () => {
    const config = configFor({ EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_WEB_URL: WEB });
    const prefixes = [config.android?.intentFilters?.[0]?.data ?? []].flat().map((entry) => entry.pathPrefix);
    expect(prefixes).toContain('/u/');
    expect(prefixes.filter((prefix) => prefix !== undefined).every((prefix) => prefix.endsWith('/'))).toBe(true);
  });

  it.each([
    ['local', WEB],
    ['lan', 'http://192.168.110.92:8080'],
    [undefined, WEB],
  ])('%s builds keep the speedclub scheme only', (appEnv, webUrl) => {
    const config = configFor({ EXPO_PUBLIC_APP_ENV: appEnv, EXPO_PUBLIC_WEB_URL: webUrl });
    expect(config.android?.intentFilters).toBeUndefined();
    expect(config.ios?.associatedDomains).toBeUndefined();
    expect(config.scheme).toBe('speedclub');
  });

  it.each([
    ['no web URL', undefined],
    ['plain http', 'http://speedclub.de'],
    ['not a URL', 'speedclub'],
  ])('a production build with %s links nothing rather than a host that cannot verify', (_case, webUrl) => {
    const config = configFor({ EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_WEB_URL: webUrl });
    expect(config.android?.intentFilters).toBeUndefined();
    expect(config.ios?.associatedDomains).toBeUndefined();
  });

  it('keeps cleartext for local and lan builds only, as before', () => {
    const plugin = (config: ExpoConfig) =>
      (config.plugins ?? []).find((entry) => Array.isArray(entry) && entry[0] === 'expo-build-properties') as
        | [string, { android: { usesCleartextTraffic: boolean } }]
        | undefined;
    expect(plugin(configFor({ EXPO_PUBLIC_APP_ENV: 'lan' }))?.[1].android.usesCleartextTraffic).toBe(true);
    expect(plugin(configFor({ EXPO_PUBLIC_APP_ENV: 'staging', EXPO_PUBLIC_WEB_URL: WEB }))?.[1].android.usesCleartextTraffic).toBe(false);
  });
});
