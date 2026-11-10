import { holdAppInert } from '@/ui/overlay';

function fakeRoot() {
  const attributes = new Set<string>();
  return {
    attributes,
    setAttribute: (name: string) => void attributes.add(name),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
}

describe('holdAppInert', () => {
  it('makes the app root inert and restores it on release', () => {
    const root = fakeRoot();
    const release = holdAppInert(root);
    expect(root.attributes.has('inert')).toBe(true);
    release();
    expect(root.attributes.has('inert')).toBe(false);
  });

  it('stays inert until the last of several open overlays closes, and a double release counts once', () => {
    const root = fakeRoot();
    const first = holdAppInert(root);
    const second = holdAppInert(root);
    first();
    first();
    expect(root.attributes.has('inert')).toBe(true);
    second();
    expect(root.attributes.has('inert')).toBe(false);
  });

  it('does nothing without a root', () => {
    expect(() => holdAppInert(null)()).not.toThrow();
  });
});
