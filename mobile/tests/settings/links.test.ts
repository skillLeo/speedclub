import { resolveLink } from '@/features/settings/markdown/links';

const SITE = 'https://speedclub.de';

describe('resolveLink', () => {
  it.each([
    ['/settings/legal/privacy', { kind: 'internal', path: '/settings/legal/privacy' }],
    ['/app/settings/legal/terms', { kind: 'internal', path: '/settings/legal/terms' }],
    ['/v/nissan-skyline-gt-r-r34-5tf974vj?ref=legal#top', { kind: 'internal', path: '/v/nissan-skyline-gt-r-r34-5tf974vj?ref=legal#top' }],
    ['https://speedclub.de/app/profile', { kind: 'internal', path: '/profile' }],
    ['/konto-loeschen', { kind: 'external', url: 'https://speedclub.de/konto-loeschen' }],
    ['https://speedclub.de/impressum', { kind: 'external', url: 'https://speedclub.de/impressum' }],
    ['https://ec.europa.eu/consumers/odr', { kind: 'external', url: 'https://ec.europa.eu/consumers/odr' }],
    ['mailto:datenschutz@speedclub.de', { kind: 'external', url: 'mailto:datenschutz@speedclub.de' }],
    ['MAILTO:datenschutz@speedclub.de?subject=x', { kind: 'external', url: 'mailto:datenschutz@speedclub.de' }],
  ])('opens %s', (href, target) => {
    expect(resolveLink(href, SITE)).toEqual(target);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'intent://evil#Intent;end',
    'speedclub://settings',
    '//evil.example/phish',
    '/\\evil.example',
    '/%2F%2Fevil.example',
    '/settings/%0Aevil',
    'https://user:pass@speedclub.de/',
    'relative/path',
    '#section',
    '',
    'mailto:',
    'mailto:not-an-address',
    `https://speedclub.de/${'a'.repeat(3000)}`,
  ])('refuses %j', (href) => {
    expect(resolveLink(href, SITE)).toBeNull();
  });

  it('leaves a site path as text where no site is known', () => {
    expect(resolveLink('/konto-loeschen', null)).toBeNull();
    expect(resolveLink('/settings/legal', null)).toEqual({ kind: 'internal', path: '/settings/legal' });
  });

  it('does not treat a lookalike host as the site', () => {
    expect(resolveLink('https://speedclub.de.evil.example/app/profile', SITE)).toEqual({
      kind: 'external',
      url: 'https://speedclub.de.evil.example/app/profile',
    });
  });
});
