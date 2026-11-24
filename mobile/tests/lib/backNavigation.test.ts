/**
 * R4B-007: after a direct link the tab root Expo Router puts under a nested screen carries the screen's own parameters; that root
 * is not where the member came from, so "Zurück" goes to the screen's parent instead.
 */
import { backSkipsSyntheticRoot, onlySyntheticRootBelow } from '@/lib/backNavigation';

describe('onlySyntheticRootBelow', () => {
  it('is true for the root added under a direct link (it copied every parameter of the screen)', () => {
    expect(onlySyntheticRootBelow({ index: 1, routes: [{ name: 'index', params: { slug: 'r34' } }, { name: 'v/[slug]/gallery', params: { slug: 'r34' } }] })).toBe(true);
    expect(onlySyntheticRootBelow({ index: 1, routes: [{ name: 'index', params: { key: 'two-factor' } }, { name: 'settings/help/[key]', params: { key: 'two-factor' } }] })).toBe(true);
  });

  it('ignores search parameters such as the QA overrides on either route', () => {
    expect(
      onlySyntheticRootBelow({ index: 1, routes: [{ name: 'discover/index', params: { slug: 'r34' } }, { name: 'v/[slug]/gallery', params: { slug: 'r34', qaNow: '2026-11-15T10:00:00Z', qaMotion: 'off' } }] }),
    ).toBe(true);
    expect(onlySyntheticRootBelow({ index: 1, routes: [{ name: 'profile/index', params: { key: 'two-factor', qaMotion: 'off' } }, { name: 'settings/help/[key]', params: { key: 'two-factor' } }] })).toBe(true);
  });

  it('is false when the member really came from the screen below', () => {
    expect(onlySyntheticRootBelow({ index: 1, routes: [{ name: 'index' }, { name: 'v/[slug]/gallery', params: { slug: 'r34' } }] })).toBe(false);
    expect(onlySyntheticRootBelow({ index: 1, routes: [{ name: 'v/[slug]', params: { slug: 'other' } }, { name: 'v/[slug]/gallery', params: { slug: 'r34' } }] })).toBe(false);
  });

  it('is false for deeper stacks, a screen without parameters and anything that is not a stack state', () => {
    expect(
      onlySyntheticRootBelow({
        index: 2,
        routes: [{ name: 'index', params: { slug: 'r34' } }, { name: 'v/[slug]', params: { slug: 'r34' } }, { name: 'v/[slug]/gallery', params: { slug: 'r34' } }],
      }),
    ).toBe(false);
    expect(onlySyntheticRootBelow({ index: 1, routes: [{ name: 'index' }, { name: 'forum' }] })).toBe(false);
    expect(onlySyntheticRootBelow(undefined)).toBe(false);
    expect(onlySyntheticRootBelow({ index: 0, routes: [{ name: 'index' }] })).toBe(false);
  });
});

describe('backSkipsSyntheticRoot', () => {
  const coldVehicle = { index: 1, routes: [{ name: 'discover/index', params: { slug: 'r34' } }, { name: 'v/[slug]', params: { slug: 'r34' } }] };
  const coldGallery = { index: 1, routes: [{ name: 'discover/index', params: { slug: 'r34' } }, { name: 'v/[slug]/gallery', params: { slug: 'r34' } }] };

  it('keeps the anchor for a fallback that names no parent but the tab (ADR-101: VEH-01 back → Entdecken)', () => {
    expect(backSkipsSyntheticRoot(coldVehicle, '/')).toBe(false);
    expect(backSkipsSyntheticRoot(coldVehicle, '/discover')).toBe(false);
    expect(backSkipsSyntheticRoot(coldVehicle, '/discover/?qaMotion=off')).toBe(false);
    expect(backSkipsSyntheticRoot({ index: 1, routes: [{ name: 'index', params: { id: 'n1' } }, { name: 'messages/[id]', params: { id: 'n1' } }] }, '/')).toBe(false);
  });

  it('skips it for a deeper parent (R4B-007: the gallery goes to its vehicle, a conversation to the inbox)', () => {
    expect(backSkipsSyntheticRoot(coldGallery, '/v/r34')).toBe(true);
    expect(backSkipsSyntheticRoot({ index: 1, routes: [{ name: 'index', params: { id: 'n1' } }, { name: 'messages/[id]', params: { id: 'n1' } }] }, '/messages')).toBe(true);
    expect(backSkipsSyntheticRoot(coldGallery, '/profile')).toBe(true);
    expect(backSkipsSyntheticRoot(coldGallery, { pathname: '/v/[slug]', params: { slug: 'r34' } })).toBe(true);
  });

  it('never skips a route the member really came from', () => {
    expect(backSkipsSyntheticRoot({ index: 1, routes: [{ name: 'discover/index' }, { name: 'v/[slug]/gallery', params: { slug: 'r34' } }] }, '/v/r34')).toBe(false);
    expect(backSkipsSyntheticRoot(undefined, '/v/r34')).toBe(false);
  });
});
