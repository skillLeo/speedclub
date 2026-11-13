import { redirectSystemPath } from '@/app/+native-intent';
import { mapIncomingPath } from '@/features/shell/nativeIntent';

describe('mapIncomingPath', () => {
  it.each([
    ['/app', '/'],
    ['/app/', '/'],
    ['/app/garage', '/garage'],
    ['/app/v/skyline?x=1', '/v/skyline?x=1'],
    ['/app?x=1', '/?x=1'],
    ['/C/AB12CD', '/c/AB12CD'],
    ['/app/C/AB12CD', '/c/AB12CD'],
    ['/c/AB12CD', '/c/AB12CD'],
    ['https://speedclub.de/C/AB12CD', '/c/AB12CD'],
    ['https://speedclub.de/app/garage', '/garage'],
    ['https://speedclub.de', '/'],
    ['speedclub://garage', '/garage'],
    ['speedclub://C/AB12CD', '/c/AB12CD'],
    ['speedclub:///v/skyline', '/v/skyline'],
    ['garage', '/garage'],
    ['/', '/'],
  ])('%s -> %s', (incoming, expected) => {
    expect(mapIncomingPath(incoming)).toBe(expected);
  });

  it('keeps routes that only start like the prefixes', () => {
    expect(mapIncomingPath('/apple')).toBe('/apple');
    expect(mapIncomingPath('/Cars')).toBe('/Cars');
    expect(mapIncomingPath('/C')).toBe('/C');
  });

  it('leaves the dev client launch URL alone', () => {
    const url = 'exp+speedclub://expo-development-client/?url=http%3A%2F%2F10.0.0.1%3A8081';
    expect(mapIncomingPath(url)).toBe(url);
  });

  it('never returns an address on another host', () => {
    expect(mapIncomingPath('//evil.example/app/garage')).toBe('/evil.example/app/garage');
    expect(mapIncomingPath('https://speedclub.de//evil.example/x')).toBe('/evil.example/x');
  });
});

describe('the reset link (ADR-138)', () => {
  const SITE = ['speedclub.de'];
  const map = (incoming: string) => mapIncomingPath(incoming, SITE);
  /** What expo-router hands the screen: the query of the mapped path, decoded. */
  const paramsOf = (path: string) => Object.fromEntries(new URL(path, 'file:').searchParams);
  const MAIL_FRAGMENT = 'code=482913&email=jann.peters%2Bgarage%40example.de';

  it.each([
    ['the mail link on the site', `https://speedclub.de/app/reset-password#${MAIL_FRAGMENT}`],
    ['the site in capitals', `HTTPS://SpeedClub.DE/app/reset-password#${MAIL_FRAGMENT}`],
    ['a bare path', `/app/reset-password#${MAIL_FRAGMENT}`],
    ['a trailing slash', `https://speedclub.de/app/reset-password/#${MAIL_FRAGMENT}`],
  ])('%s turns code and address into the params the screen reads', (_name, incoming) => {
    const path = map(incoming);
    expect(path).not.toContain('#');
    expect(path.split('?')[0]).toMatch(/^\/reset-password\/?$/);
    expect(paramsOf(path)).toEqual({ code: '482913', email: 'jann.peters+garage@example.de' });
  });

  it('keeps the other query params of the route, and takes nothing but code and address from the fragment', () => {
    const path = map(`https://speedclub.de/app/reset-password?forced=1#${MAIL_FRAGMENT}&returnTo=https%3A%2F%2Fevil.example&forced=0&password=x`);
    expect(paramsOf(path)).toEqual({ forced: '1', code: '482913', email: 'jann.peters+garage@example.de' });
  });

  it('takes no code or address from the query, where no mail puts them', () => {
    expect(map('/app/reset-password?code=111111&email=evil%40example.de')).toBe('/reset-password');
    expect(paramsOf(map('/app/reset-password?code=111111#code=482913'))).toEqual({ code: '482913' });
  });

  it.each([
    ['an encoded separator in the code', 'code=482913%26email%3Devil%40example.de'],
    ['a second fragment', 'code=482913#email=evil@example.de'],
    ['a query in the fragment', 'code=482913?email=evil@example.de'],
    ['letters', 'code=48291a'],
    ['too short', 'code=48291'],
    ['too long', 'code=4829130'],
    ['spaces', 'code=482%20913'],
    ['other digits', 'code=%D9%A4%D9%A8%D9%A2%D9%A9%D9%A1%D9%A3'],
    ['a broken escape', 'code=%E0%A4%A'],
    ['no value', 'code'],
    ['a code given twice', 'code=482913&code=111111'],
  ])('drops the code on %s', (_name, fragment) => {
    expect(paramsOf(map(`/app/reset-password#${fragment}`)).code).toBeUndefined();
  });

  it.each([
    ['no @', 'email=jann.example.de'],
    ['two parts with spaces', 'email=jann%20peters%40example.de'],
    ['a line break', 'email=jann%40example.de%0D%0ABcc%3Aevil%40example.de'],
    ['a direction override', 'email=jann%E2%80%AE%40example.de'],
    ['a zero-width space', 'email=jann%E2%80%8B%40example.de'],
    ['more than 254 characters', `email=${'a'.repeat(250)}%40example.de`],
    ['an address given twice', 'email=jann%40example.de&email=evil%40example.de'],
  ])('drops the address on %s', (_name, fragment) => {
    expect(paramsOf(map(`/app/reset-password#code=482913&${fragment}`))).toEqual({ code: '482913' });
  });

  it('encodes what it passes on, so a value cannot add a param of its own', () => {
    const path = map('/app/reset-password#email=jann%26forced%3D1%40example.de');
    expect(paramsOf(path)).toEqual({ email: 'jann&forced=1@example.de' });
  });

  it.each([
    ['another host', `https://evil.example/app/reset-password#${MAIL_FRAGMENT}`],
    ['a look-alike host', `https://speedclub.de.evil.example/app/reset-password#${MAIL_FRAGMENT}`],
    ['the site as user name of another host', `https://speedclub.de@evil.example/app/reset-password#${MAIL_FRAGMENT}`],
    ['the site on another port', `https://speedclub.de:8443/app/reset-password#${MAIL_FRAGMENT}`],
    ['another scheme', `evil://reset-password#${MAIL_FRAGMENT}`],
    // SEC-P1-15 / SEC-P2-03: any app can claim the custom scheme.
    ['the app scheme', `speedclub://reset-password#${MAIL_FRAGMENT}`],
    ['the app scheme with a path', `speedclub:///reset-password#${MAIL_FRAGMENT}`],
  ])('opens the screen empty from %s', (_name, incoming) => {
    expect(map(incoming)).toBe('/reset-password');
  });

  it('takes no address from the app scheme on sign-in or forgot-password (SEC-P1-15)', () => {
    expect(map('speedclub://sign-in#email=jann%40example.de')).toBe('/sign-in');
    expect(map('speedclub://forgot-password#email=jann%40example.de')).toBe('/forgot-password');
    expect(paramsOf(map('https://speedclub.de/app/sign-in#email=jann%40example.de'))).toEqual({ email: 'jann@example.de' });
  });

  it('carries nothing over https when the build knows no site', () => {
    expect(mapIncomingPath(`https://speedclub.de/app/reset-password#${MAIL_FRAGMENT}`, [])).toBe('/reset-password');
  });

  it.each([
    ['/app/garage', '/garage'],
    ['/app/reset-password-old', '/reset-password-old'],
    ['/app/reset-password/x', '/reset-password/x'],
    ['/app/v/skyline?tab=mods', '/v/skyline?tab=mods'],
    ['https://speedclub.de/app/C/AB12CD', '/c/AB12CD'],
  ])('drops the fragment on %s', (path, expected) => {
    expect(map(`${path}#${MAIL_FRAGMENT}`)).toBe(expected);
    expect(map(`${path}#section`)).toBe(expected);
  });

  it.each(['sign-in', 'forgot-password'])('the account-exists link to %s carries the address from its fragment, and nothing else (M2.5)', (route) => {
    const path = map(`https://speedclub.de/app/${route}#${MAIL_FRAGMENT}`);
    expect(path.split('?')[0]).toBe(`/${route}`);
    expect(paramsOf(path)).toEqual({ email: 'jann.peters+garage@example.de' });
    expect(map(`https://speedclub.de/app/${route}#section`)).toBe(`/${route}`);
    // Only the site's own links: another host opens the screen empty, and a query address is no mail's any more.
    expect(map(`https://evil.example/app/${route}#${MAIL_FRAGMENT}`)).toBe(`/${route}`);
    expect(map(`https://speedclub.de/app/${route}?email=jann%40example.de`)).toBe(`/${route}`);
  });
});

describe('the site hosts of a build', () => {
  const setEnv = (key: 'EXPO_PUBLIC_WEB_URL' | 'EXPO_PUBLIC_API_URL', value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  const load = (env: { web?: string; api?: string }) => {
    const saved = { web: process.env.EXPO_PUBLIC_WEB_URL, api: process.env.EXPO_PUBLIC_API_URL };
    setEnv('EXPO_PUBLIC_WEB_URL', env.web);
    setEnv('EXPO_PUBLIC_API_URL', env.api);
    let hosts: readonly string[] = [];
    try {
      jest.isolateModules(() => {
        hosts = jest.requireActual<typeof import('@/features/shell/nativeIntent')>('@/features/shell/nativeIntent').SITE_HOSTS;
      });
    } finally {
      setEnv('EXPO_PUBLIC_WEB_URL', saved.web);
      setEnv('EXPO_PUBLIC_API_URL', saved.api);
    }
    return hosts;
  };

  it('come from the public web and API URLs, without scheme, path or case', () => {
    expect(load({ web: 'https://SpeedClub.de/', api: 'https://api.speedclub.de/api' })).toEqual(['speedclub.de', 'api.speedclub.de']);
    expect(load({ web: 'http://192.168.178.20:8080' })).toEqual(['192.168.178.20:8080']);
  });

  it('are none when the build has no URLs', () => {
    expect(load({ web: '' })).toEqual([]);
    expect(load({})).toEqual([]);
  });
});

it('the route file exports what expo-router calls', () => {
  expect(redirectSystemPath({ path: '/app/C/X1', initial: true })).toBe('/c/X1');
});

describe('the magic and secure links (M4.6, M4.7)', () => {
  const SITE = ['speedclub.de'];
  const map = (incoming: string) => mapIncomingPath(incoming, SITE);
  const paramsOf = (path: string) => Object.fromEntries(new URL(path, 'file:').searchParams);
  const MAGIC = 'kq3V9mX2pL7rT1sB8nW4yZ6cD0fG5hJ2aE9uQ7iO3x_';
  const SECURE = '01JCZ8Q3M5W6X7Y8Z9A0B1C2D3.0f1e2d3c4b5a69788796a5b4c3d2e1f0';

  it.each([
    ['the mail link on the site root', `https://speedclub.de/auth/magic#t=${MAGIC}`, '/auth/magic'],
    ['the web route', `https://speedclub.de/app/auth/magic#t=${MAGIC}`, '/auth/magic'],
    ['a bare path', `/app/auth/magic#t=${MAGIC}`, '/auth/magic'],
  ])('the magic link from %s hands its token to the screen', (_name, incoming, route) => {
    const path = map(incoming);
    expect(path.split('?')[0]).toBe(route);
    expect(paramsOf(path)).toEqual({ t: MAGIC });
  });

  it('the secure link hands its token to the screen', () => {
    const path = map(`https://speedclub.de/auth/secure#t=${SECURE}`);
    expect(path.split('?')[0]).toBe('/auth/secure');
    expect(paramsOf(path)).toEqual({ t: SECURE });
  });

  it.each([
    ['the app scheme', `speedclub://auth/magic#t=${MAGIC}`],
    ['another host', `https://evil.example/auth/magic#t=${MAGIC}`],
    ['the query', `/app/auth/magic?t=${MAGIC}`],
    ['a token given twice', `/app/auth/magic#t=${MAGIC}&t=${MAGIC}`],
    ['a token of another shape', '/app/auth/magic#t=short'],
  ])('carries no magic token from %s', (_name, incoming) => {
    expect(map(incoming)).toBe('/auth/magic');
  });

  it.each([
    ['the app scheme', `speedclub://auth/secure#t=${SECURE}`],
    ['a magic token', `/app/auth/secure#t=${MAGIC}`],
    ['the query', `/app/auth/secure?t=${SECURE}`],
  ])('carries no secure token from %s', (_name, incoming) => {
    expect(map(incoming)).toBe('/auth/secure');
  });

  it('takes nothing else from the fragment', () => {
    expect(paramsOf(map(`/app/auth/magic#t=${MAGIC}&returnTo=https%3A%2F%2Fevil.example&code=482913`))).toEqual({ t: MAGIC });
  });
});
