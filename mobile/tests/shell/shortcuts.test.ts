import { createShortcutHandler, isTypingTarget, modifierLabel, SEQUENCE_TIMEOUT_MS, type KeyLike } from '@/features/shell/shortcuts/keys';
import { filterSwitcher, moveActive, SWITCHER_GROUP_LIMIT, type SwitcherItem } from '@/features/shell/shortcuts/switcher';

function element(tagName: string, extra: Record<string, unknown> = {}) {
  return { tagName, getAttribute: (name: string) => (name === 'role' ? ((extra.role as string | undefined) ?? null) : null), ...extra };
}

const BODY = element('BODY');

function setup(overlay = false) {
  let clock = 1_000;
  const handle = createShortcutHandler({ now: () => clock, overlayOpen: () => overlay });
  const press = (key: string, extra: Partial<KeyLike> = {}) => handle({ key, target: BODY, ...extra });
  return { press, tick: (ms: number) => (clock += ms) };
}

describe('web shortcuts (sig.web_shortcuts)', () => {
  it('maps the single keys', () => {
    const { press } = setup();
    expect(press('/')).toEqual({ kind: 'focusSearch' });
    expect(press('?', { shiftKey: true })).toEqual({ kind: 'help' });
    expect(press('k', { metaKey: true })).toEqual({ kind: 'switcher' });
    expect(press('K', { ctrlKey: true })).toEqual({ kind: 'switcher' });
  });

  it('jumps to a tab with g and a letter', () => {
    const { press } = setup();
    for (const [letter, tab] of [['h', 'home'], ['d', 'discover'], ['g', 'garage'], ['m', 'messages'], ['p', 'profile']] as const) {
      expect(press('g')).toBeNull();
      expect(press(letter)).toEqual({ kind: 'tab', tab });
    }
  });

  it('forgets g after the timeout and after any other key', () => {
    const { press, tick } = setup();
    press('g');
    tick(SEQUENCE_TIMEOUT_MS + 1);
    expect(press('h')).toBeNull();
    press('g');
    expect(press('x')).toBeNull();
    expect(press('h')).toBeNull();
  });

  it('ignores every key while the member types in a field', () => {
    const { press } = setup();
    for (const target of [element('INPUT'), element('INPUT', { type: 'search' }), element('TEXTAREA'), element('SELECT'), element('DIV', { isContentEditable: true }), element('DIV', { role: 'searchbox' })]) {
      expect(press('/', { target })).toBeNull();
      expect(press('k', { metaKey: true, target })).toBeNull();
      expect(press('g', { target })).toBeNull();
      expect(press('h', { target })).toBeNull();
    }
  });

  it('works on a focused checkbox or button, which take no typing', () => {
    expect(isTypingTarget(element('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(element('BUTTON'))).toBe(false);
    expect(setup().press('/', { target: element('BUTTON') })).toEqual({ kind: 'focusSearch' });
  });

  it('waits while an overlay is open, the IME composes, or the page already handled the key', () => {
    expect(setup(true).press('/')).toBeNull();
    expect(setup().press('/', { isComposing: true })).toBeNull();
    expect(setup().press('/', { defaultPrevented: true })).toBeNull();
  });

  it('leaves browser and system combinations alone', () => {
    const { press } = setup();
    expect(press('k', { metaKey: true, shiftKey: true })).toBeNull();
    expect(press('/', { ctrlKey: true })).toBeNull();
    expect(press('g', { altKey: true })).toBeNull();
    expect(press('h')).toBeNull();
  });

  it('labels the modifier for the keyboard', () => {
    expect(modifierLabel('MacIntel')).toBe('⌘');
    expect(modifierLabel('Win32')).toBe('Ctrl');
  });
});

describe('quick switcher list', () => {
  const items: SwitcherItem[] = [
    { id: 'v1', group: 'vehicles', label: 'Nissan Skyline GT-R R34', href: '/garage/1' },
    { id: 'v2', group: 'vehicles', label: 'Škoda Octavia RS', href: '/garage/2' },
    { id: 's1', group: 'settings', label: 'Erscheinungsbild', href: '/settings/appearance' },
    { id: 's2', group: 'settings', label: 'Konto', href: '/settings/account' },
    { id: 't1', group: 'tabs', label: 'Garage', href: '/garage' },
  ];

  it('lists every group in order without a query, a few entries each', () => {
    expect(filterSwitcher(items, '').map((item) => item.id)).toEqual(['v1', 'v2', 's1', 's2', 't1']);
    const many = Array.from({ length: 9 }, (_, index): SwitcherItem => ({ id: `v${index}`, group: 'vehicles', label: `Auto ${index}`, href: '/' }));
    expect(filterSwitcher(many, '')).toHaveLength(SWITCHER_GROUP_LIMIT);
  });

  it('filters by word start first, then anywhere, accents folded', () => {
    expect(filterSwitcher(items, 'sko').map((item) => item.id)).toEqual(['v2']);
    expect(filterSwitcher(items, 'r34').map((item) => item.id)).toEqual(['v1']);
    expect(filterSwitcher(items, 'kon').map((item) => item.id)).toEqual(['s2']);
    expect(filterSwitcher(items, 'ara').map((item) => item.id)).toEqual(['t1']);
    expect(filterSwitcher(items, 'zzz')).toEqual([]);
  });

  it('moves the active entry with the arrows and wraps', () => {
    expect(moveActive(0, 3, 1)).toBe(1);
    expect(moveActive(2, 3, 1)).toBe(0);
    expect(moveActive(0, 3, -1)).toBe(2);
    expect(moveActive(-1, 3, -1)).toBe(2);
    expect(moveActive(0, 0, 1)).toBe(-1);
  });
});
