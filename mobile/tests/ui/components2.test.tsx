/** M4.4 part 2 (09 §5): MediaCard, Timeline, BuildSheet, ContextMenu and OwnerCapsule: states, roles, labels. */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, radius, size, space, themes, typography } from '@/theme';
import { BuildSheet } from '@/ui/BuildSheet';
import { ContextMenu, orderMenuItems, type ContextMenuItem } from '@/ui/ContextMenu';
import { MediaCard, MediaCardSkeleton } from '@/ui/MediaCard';
import { OwnerCapsule, ownerCapsuleVisibleActions } from '@/ui/OwnerCapsule';
import { Timeline } from '@/ui/Timeline';

import { flat, renderUi, textOf } from './helpers';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  AndroidHaptics: {},
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

const PHOTO = { source: 1, blurhash: 'LoGlekxvjYof_Nt7ayj]M{j@ofWB', focal: { x: 0.5, y: 0.6 } };
const NO_PHOTO = {};

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

describe('MediaCard', () => {
  it('lead: 4:5 at 0 radius, the name as a display title on the stage, one name for screen readers, save over the photo', async () => {
    const onToggle = jest.fn();
    await renderUi(
      <MediaCard
        variant="lead"
        title="Nissan Skyline GT-R R34"
        photo={PHOTO}
        spec="500 PS · AWD"
        owner={{ username: 'lukas.sc' }}
        save={{ saved: false, onToggle }}
        sample={{ is_sample: true }}
        onPress={jest.fn()}
        layoutWidth={390}
        testID="c"
      />,
    );
    const photo = flat(screen.getByTestId('c.photo').props.style);
    expect(photo.aspectRatio).toBe(4 / 5);
    expect(photo.borderRadius).toBe(0);
    expect(flat(screen.getByTestId('c').props.style).backgroundColor).toBe(themes.carbon.color.scrim.photoEnd);
    // ADR-426 a, placement card: 30, or 24 where that brings the name to one line (here it does).
    expect([typography.displayTitle.fontSize, 24]).toContain(flat(screen.getByTestId('c.title').props.style).fontSize);
    expect(textOf(screen.getByTestId('c.title').props.style).fontFamily).toBe(typography.displayTitle.fontFamily);
    expect(flat(screen.getByTestId('c.title').props.style).color).toBe(themes.carbon.color.onPhoto.primary);
    expect(screen.getByTestId('c.open').props.accessibilityLabel).toBe('Beispiel, Nissan Skyline GT-R R34, @lukas.sc, 500 PS · AWD');
    expect(screen.getByTestId('c.sample.sample')).toHaveTextContent('Beispiel');
    await fireEvent.press(screen.getByTestId('c.save'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('feed: header, edge-to-edge media with the page pill for several photos, caption, mod chips, actions without counts', async () => {
    const onMod = jest.fn();
    await renderUi(
      <MediaCard
        variant="feed"
        title="BMW M3 E46"
        photos={[PHOTO, PHOTO, PHOTO]}
        owner={{ username: 'lukas.sc' }}
        time="vor 2 Std."
        caption="KW V3 ist drin."
        mods={[{ key: 'kw', label: 'KW V3', onPress: onMod }]}
        save={{ saved: true, onToggle: jest.fn() }}
        onShare={jest.fn()}
        testID="f"
      />,
    );
    expect(flat(screen.getByTestId('f.page.0').props.style).aspectRatio).toBe(4 / 5);
    expect(screen.getByTestId('f.pages')).toBeTruthy();
    // DQ-971: without a cover the vehicle shows a glyph tile, never initials; then name and owner line.
    expect(screen.getByTestId('f.vehicleGlyph')).toBeTruthy();
    expect(screen.getByTestId('f.header')).toHaveTextContent('BMW M3 E46@lukas.sc · vor 2 Std.');
    expect(screen.getByTestId('f.caption')).toHaveTextContent('KW V3 ist drin.');
    await fireEvent.press(screen.getByTestId('f.mod.kw'));
    expect(onMod).toHaveBeenCalled();
    expect(screen.getByTestId('f.share').props.accessibilityLabel).toBe('Teilen');
    // No public counts anywhere on the card.
    expect(screen.getByTestId('f')).not.toHaveTextContent(/\d+ (Reaktionen|Likes)/);
  });

  it('feed: one photo has no pager and a square crop when asked', async () => {
    await renderUi(<MediaCard variant="feed" square title="BMW M3 E46" photos={[PHOTO]} owner={{ username: 'lukas.sc' }} time="jetzt" testID="f" />);
    expect(screen.queryByTestId('f.pages')).toBeNull();
    expect(flat(screen.getByTestId('f.page.0').props.style).aspectRatio).toBe(1);
  });

  it('rail: 3:4 at radius 12 with the name and the spec below', async () => {
    await renderUi(<MediaCard variant="rail" title="BMW M3 E46" photo={NO_PHOTO} spec="343 PS · RWD" onPress={jest.fn()} testID="r" />);
    const photo = flat(screen.getByTestId('r.photo').props.style);
    expect(photo.aspectRatio).toBe(3 / 4);
    expect(photo.borderRadius).toBe(radius.md);
    // A missing photo keeps the box and shows the quiet glyph.
    expect(screen.getByTestId('r.photo.fallback', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('r.title')).toHaveTextContent('BMW M3 E46');
  });

  it('wall: a square tile at 0 radius with the name on the scrim', async () => {
    await renderUi(<MediaCard variant="wall" title="BMW M3 E46" photo={PHOTO} testID="w" />);
    expect(flat(screen.getByTestId('w.photo').props.style).aspectRatio).toBe(1);
    expect(flat(screen.getByTestId('w.photo').props.style).borderRadius).toBe(0);
    expect(flat(screen.getByTestId('w.title').props.style).color).toBe(themes.carbon.color.onPhoto.primary);
  });

  it('wall at 200 %: the name leaves the photo and sits under it, uncut, in page colours (ADR-128)', async () => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
    await renderUi(<MediaCard variant="wall" title="Volkswagen Golf GTI Clubsport S" photo={PHOTO} testID="w" />);
    const title = screen.getByTestId('w.title');
    expect(flat(title.props.style).color).toBe(themes.carbon.color.text.primary);
    expect(title.props.numberOfLines).toBeUndefined();
  });

  it('has a skeleton of the same geometry for every variant', async () => {
    await renderUi(<MediaCardSkeleton variant="rail" testID="s" />);
    expect(screen.getByTestId('s')).toBeTruthy();
  });
});

describe('Timeline', () => {
  const entries = [
    { key: 'a', date: 'Juni 2026', title: 'Fahrwerk geändert', lines: [{ key: 'kw', label: 'Fahrwerk', detail: 'Serie → KW V3' }], photos: [PHOTO, PHOTO, PHOTO, PHOTO], mileage: '48.200 km', onPress: jest.fn() },
    { key: 'b', date: 'Juni 2026', title: 'Notiz', note: 'Neu vermessen.' },
    { key: 'c', date: 'März 2023', title: 'Gekauft', testID: 'own.c' },
  ];

  it('groups by month under headings, on a hairline spine, and keeps an entry’s own testID', async () => {
    await renderUi(<Timeline entries={entries} testID="t" />);
    expect(screen.getByTestId('t.group.0')).toHaveTextContent(/^Juni 2026Fahrwerk geändert/);
    expect(screen.getByTestId('t.group.1')).toHaveTextContent(/^März 2023/);
    expect(screen.getByTestId('own.c')).toBeTruthy();
  });

  it('shows at most three photos, the mileage tabular, and opens the entry', async () => {
    await renderUi(<Timeline entries={entries} testID="t" />);
    expect(screen.getByTestId('t.entry.a.photos').children.length).toBe(3);
    expect(textOf(screen.getByTestId('t.entry.a.mileage').props.style).fontVariant).toContain('tabular-nums');
    await fireEvent.press(screen.getByTestId('t.entry.a'));
    expect(entries[0]!.onPress).toHaveBeenCalled();
  });
});

describe('BuildSheet', () => {
  const onPress = jest.fn();
  const sections = [
    {
      key: 'wheels',
      title: 'Räder & Reifen',
      icon: 'wheel' as const,
      count: 1,
      countLabel: '1 Mod',
      mods: [{ key: 'bbs', icon: 'wheel' as const, name: 'BBS LM', brand: 'BBS', values: '19″ × 9,5J', status: 'Verbaut', details: [{ label: 'Eingebaut', value: 'Juni 2026' }], onPress, testID: 'b.bbs' }],
    },
  ];

  it('heads each system with its count and opens a mod from its row (at least 64, glyph in the 40 tile)', async () => {
    await renderUi(<BuildSheet sections={sections} testID="b" />);
    expect(screen.getByTestId('b.wheels')).toHaveTextContent(/^Räder & Reifen\s1BBS LM/);
    // The row's content box (inside the pressable) is at least 64 high.
    const content = screen.getByTestId('b.bbs.body').children[0];
    expect(typeof content === 'object' && content !== null ? flat(content.props.style).minHeight : null).toBe(size.row.mod);
    await fireEvent.press(screen.getByTestId('b.bbs.body'));
    expect(onPress).toHaveBeenCalled();
  });

  it('expands the details inline with its own control, which says its state', async () => {
    await renderUi(<BuildSheet sections={sections} testID="b" />);
    expect(screen.queryByTestId('b.bbs.details')).toBeNull();
    const toggle = screen.getByTestId('b.bbs.toggle');
    expect(toggle.props.accessibilityState.expanded).toBe(false);
    expect(toggle.props.accessibilityLabel).toBe('Details zu BBS LM anzeigen');
    await fireEvent.press(toggle);
    expect(screen.getByTestId('b.bbs.details')).toHaveTextContent('EingebautJuni 2026');
    expect(screen.getByTestId('b.bbs.toggle').props.accessibilityState.expanded).toBe(true);
  });
});

describe('ContextMenu', () => {
  const items: ContextMenuItem[] = [
    { key: 'report', label: 'Melden', destructive: true, onSelect: jest.fn() },
    { key: 'share', label: 'Teilen', icon: 'share-network', onSelect: jest.fn() },
    { key: 'off', label: 'Ausblenden', disabled: true, onSelect: jest.fn() },
  ];

  it('puts destructive items last', () => {
    expect(orderMenuItems(items).map((item) => item.key)).toEqual(['share', 'off', 'report']);
  });

  it('is a menu of menu items by its anchor; choosing one closes the menu first, then acts', async () => {
    const onClose = jest.fn();
    await renderUi(<ContextMenu visible anchor={{ x: 300, y: 100, width: 44, height: 44 }} items={items} label="Weitere Aktionen" onClose={onClose} testID="m" />);
    const menu = screen.getByTestId('m');
    expect(menu.props.role).toBe('menu');
    // Not placed before its size is known: invisible for one layout.
    expect(flat(menu.props.style).opacity).toBe(0);
    await fireEvent(menu, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 240, height: 140 } } });
    expect(flat(screen.getByTestId('m').props.style).top).toBe(100 + 44 + space[4]);
    expect(screen.getByTestId('m.share').props.role).toBe('menuitem');
    expect(flat(screen.getByTestId('m.report').props.style)).toBeDefined();
    await fireEvent.press(screen.getByTestId('m.share'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(items[1]!.onSelect).toHaveBeenCalledTimes(1);
  });

  it('never runs a disabled item', async () => {
    await renderUi(<ContextMenu visible anchor={{ x: 0, y: 0, width: 0, height: 0 }} items={items} label="Menü" onClose={jest.fn()} testID="m" />);
    expect(screen.getByTestId('m.off').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      screen.getByTestId('m.off').props.onPress?.();
    });
    expect(items[2]!.onSelect).not.toHaveBeenCalled();
  });
});

describe('OwnerCapsule', () => {
  it('is a named toolbar: the S primary, at most four glyph actions with names, and Mehr', async () => {
    const actions = ['edit', 'photos', 'mods', 'qr', 'extra'].map((key) => ({ key, icon: 'wrench' as const, label: key, onPress: jest.fn() }));
    const post = jest.fn();
    await renderUi(<OwnerCapsule label="Aktionen für deinen Build" primary={{ label: 'Update posten', onPress: post }} actions={actions} more={{ label: 'Mehr', items: [{ key: 'x', label: 'Teilen', onSelect: jest.fn() }] }} testID="o" />);
    expect(screen.getByTestId('o').props.role).toBe('toolbar');
    expect(screen.getByTestId('o').props.accessibilityLabel ?? screen.getByTestId('o').props['aria-label']).toBe('Aktionen für deinen Build');
    // DQ-957: inside the 20 gutters of a phone below 430 three glyphs show; the fourth (QR) moves into Mehr, the fifth never shows.
    expect(screen.getByTestId('o.mods')).toBeTruthy();
    expect(screen.queryByTestId('o.qr')).toBeNull();
    expect(screen.queryByTestId('o.extra')).toBeNull();
    expect(screen.getByTestId('o.more')).toBeTruthy();
    expect(flat(screen.getByTestId('o').props.style).paddingHorizontal).toBe(space[20]);
    expect(ownerCapsuleVisibleActions(390)).toBe(3);
    expect(ownerCapsuleVisibleActions(430)).toBe(4);
    expect(flat(screen.getByTestId('o.surface').props.style).borderRadius).toBe(radius.full);
    await fireEvent.press(screen.getByTestId('o.primary'));
    expect(post).toHaveBeenCalled();
  });

  it('DQ-979: narrow, the action of lowest priority moves into Mehr, so QR stays', async () => {
    const priorities: Record<string, number> = { edit: 1, photos: 3, mods: 2, qr: 0 };
    const actions = ['edit', 'photos', 'mods', 'qr'].map((key) => ({ key, icon: 'wrench' as const, label: key, onPress: jest.fn(), priority: priorities[key] }));
    await renderUi(<OwnerCapsule label="Aktionen" primary={{ label: 'Update posten', onPress: jest.fn() }} actions={actions} more={{ label: 'Mehr', items: [] }} testID="o" />);
    expect(screen.getByTestId('o.qr')).toBeTruthy();
    expect(screen.getByTestId('o.edit')).toBeTruthy();
    expect(screen.getByTestId('o.mods')).toBeTruthy();
    expect(screen.queryByTestId('o.photos')).toBeNull();
  });
});
