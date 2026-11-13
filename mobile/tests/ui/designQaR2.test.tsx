/**
 * M4.4 design QA round 2 (docs/reports/design-qa/phase-4/2026-11-12-M4.4.md, "Round 2"): the stacked sticky pair (DQ-978), the
 * lead skeleton's geometry (DQ-980), the Timeline's meta line (DQ-977) and its node at 200 % (DQ-982). The capsule's priority
 * overflow (DQ-979) is in components2.test.tsx.
 */
import { screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, space, typography } from '@/theme';
import { MediaCardSkeleton } from '@/ui/MediaCard';
import { MEDIA_ASPECT } from '@/ui/mediaCardLayout';
import { ratioOf } from '@/ui/Photo';
import { StickyCTABar } from '@/ui/StickyCTABar';
import { Timeline } from '@/ui/Timeline';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));
const dimensions = useWindowDimensions as jest.Mock;
jest.mock('expo-haptics', () => ({}));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

describe('DQ-978 stacked sticky pair', () => {
  it('puts the primary first and the text action centred under it, full width', async () => {
    await renderUi(
      <StickyCTABar label="Änderungen speichern" onPress={jest.fn()} secondary={{ label: 'Entwurf speichern', onPress: jest.fn(), testID: 'c.draft' }} stacked testID="c" />,
    );
    const bar = screen.getByTestId('c');
    // [0] is the zero-high measure of the row's width.
    const stack = bar.children[1];
    const order = typeof stack === 'string' ? [] : stack!.children.map((child) => (typeof child === 'string' ? child : child.props.testID));
    expect(order).toEqual(['c.primary', 'c.draft']);
    expect(flat(screen.getByTestId('c.draft').props.style).alignSelf).toBe('stretch');
  });

  it('keeps the row when the label fits beside the draft action', async () => {
    await renderUi(<StickyCTABar label="Weiter" onPress={jest.fn()} secondary={{ label: 'Entwurf', onPress: jest.fn(), testID: 'c.draft' }} testID="c" />);
    const row = screen.getByTestId('c').children[1];
    expect(flat(typeof row === 'string' ? undefined : row?.props.style).flexDirection).toBe('row');
  });
});

describe('DQ-980 / DQ-983 lead skeleton', () => {
  it('is the stage with a block of the lead aspect and the identity bars over its bottom, as the loaded lead', async () => {
    await renderUi(<MediaCardSkeleton variant="lead" testID="s" />);
    expect(flat(screen.getByTestId('s').props.style).overflow).toBe('hidden');
    expect(flat(screen.getByTestId('s.photo').props.style).aspectRatio).toBe(ratioOf(MEDIA_ASPECT.lead));
    expect(String(flat(screen.getByTestId('s.identity').props.style).marginTop)).toMatch(/^-\d/);
  });

  it('takes 16:9 on desktop', async () => {
    dimensions.mockReturnValue({ width: 1280, height: 800, scale: 1, fontScale: 1 });
    await renderUi(<MediaCardSkeleton variant="lead" testID="s" />);
    expect(flat(screen.getByTestId('s.photo').props.style).aspectRatio).toBe(ratioOf(MEDIA_ASPECT.leadWide));
  });

  it('draws a two-line name at 200 %, so the skeleton grows as the loaded lead does (DQ-983)', async () => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
    await renderUi(<MediaCardSkeleton variant="lead" testID="s" />);
    expect(screen.getByTestId('s.title').children).toHaveLength(2);
  });
});

describe('DQ-984 feed skeleton', () => {
  it('adds the caption lines and the action row under the photo, the photo on the stage', async () => {
    await renderUi(<MediaCardSkeleton variant="feed" lines={3} actions testID="f" />);
    expect(screen.getByTestId('f').children).toHaveLength(4);
  });
});

describe('DQ-977 / DQ-982 Timeline', () => {
  const entry = {
    key: 'a',
    date: 'September 2024',
    title: 'AP Racing Radi-CAL statt Brembo Serie',
    lines: [{ key: 'b', label: 'Bremsen', detail: '356 mm', inline: true }],
  };

  it('writes the meta line as "Bremsen · 356 mm" under a title that names the change', async () => {
    await renderUi(<Timeline entries={[entry]} testID="t" />);
    expect(screen.getByText('Bremsen')).toBeTruthy();
    expect(screen.getByText('·', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(/356/)).toBeTruthy();
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it('centres the node on the title line at 200 %', async () => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
    await renderUi(<Timeline entries={[entry]} testID="t" />);
    const top = flat(screen.getByTestId('t.entry.a.node', { includeHiddenElements: true }).props.style).top;
    expect(top).toBe(space[8] + (typography.headline.lineHeight * 2 - space[8]) / 2);
  });
});
