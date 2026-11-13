import { fireEvent, screen, within } from '@testing-library/react-native';
import { useWindowDimensions, type TextStyle } from 'react-native';

import { hydrateThemePreference, radius, size, space, themes, typography } from '@/theme';
import { BuildUpdateRow, BuildUpdateRowSkeleton, updateMetaText } from '@/ui/BuildUpdateRow';
import { diffSegments, metaLineText, vehicleNameText } from '@/ui/textBreaks';
import { Button } from '@/ui/Button';
import { adaptiveValueStacks, ListRow, longestWord } from '@/ui/ListRow';
import { MemberRow } from '@/ui/MemberRow';
import { ModRow } from '@/ui/ModRow';
import { OwnerRow } from '@/ui/OwnerRow';
import { Skeleton } from '@/ui/Skeleton';
import { SpecRow } from '@/ui/SpecRow';
import { Switch } from '@/ui/Switch';

import { flat, renderUi, visualOf } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;
const textStyle = (text: string) => flat(screen.getByText(text).props.style) as unknown as TextStyle;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

describe('name and diff breaks (M2.8)', () => {
  const NBSP = '\u00A0';
  const text = (diff: string, whole = true) => diffSegments(diff, whole).map((segment) => segment.text).join('');

  it('a status meta wraps before its "·", never after it (DQ-445a); the feed keeps the "·" at the line end', () => {
    expect(metaLineText('Inhalt entfernt · 23.10.2026', undefined, 'starts')).toBe(`Inhalt${NBSP}entfernt ·${NBSP}23.10.2026`);
    expect(metaLineText('Inhalt entfernt · 23.10.2026')).toBe(`Inhalt${NBSP}entfernt${NBSP}· 23.10.2026`);
  });

  it('keeps a model letter with its number, "C 63" and "A 45" (DQ-310)', () => {
    expect(vehicleNameText('Mercedes-Benz C 63 AMG W204')).toBe(`Mercedes-\u2060Benz C${NBSP}63 AMG W204`);
    expect(metaLineText('@nico.sti · Mercedes-AMG A 45 S')).toContain(`A${NBSP}45`);
    // Longer words and lowercase words before a figure still wrap as before.
    expect(vehicleNameText('Golf GTI 2,0')).toBe('Golf GTI 2,0');
    expect(vehicleNameText('Toyota Supra mk 4')).toBe('Toyota Supra mk 4');
  });

  it('wraps a diff at its "·" first and never right after "→" (DQ-313)', () => {
    const diff = 'Aero & Karosserie: Serie → Maxton Design Seitenschweller · −35 mm';
    const kept = text(diff);
    // Before and after stay together around the arrow; the long part may wrap at its other spaces.
    expect(kept).toContain(`Serie${NBSP}→${NBSP}Maxton Design Seitenschweller`);
    expect(kept).toContain(`Aero & Karosserie: Serie`);
    // The cut "·" stays with the part before it; the short part stays whole.
    expect(kept.endsWith(`Seitenschweller${NBSP}· −35${NBSP}mm`)).toBe(true);
    // A short pair stays whole.
    expect(text('Serie → KW V3 · −35 mm')).toBe(`Serie${NBSP}→${NBSP}KW${NBSP}V3${NBSP}· −35${NBSP}mm`);
  });

  it('marks only the numeric sides tabular, and at a large font lets a pair wrap after its arrow', () => {
    expect(diffSegments('Serie → KW V3 · −35 mm').filter((segment) => segment.numeric).map((segment) => segment.text)).toEqual([`−35${NBSP}mm`]);
    expect(text('Serie → Maxton Design Seitenschweller', false)).toContain(`Serie${NBSP}→ Maxton`);
  });
});

describe('BuildUpdateRow', () => {
  const props = {
    title: 'Fahrwerk geändert',
    diff: 'Serie → KW V3 · −35 mm',
    meta: '@jann.ptrs · vor 2 Std.',
    photo: { source: 'https://x/a.webp' },
  };

  it('has a 56 thumb radius 8, body.strong title, secondary diff, tertiary meta', async () => {
    await renderUi(<BuildUpdateRow {...props} testID="r" />);
    const thumb = flat(screen.getByTestId('r.thumb').props.style);
    expect(thumb.width).toBe(size.thumb.row);
    expect(thumb.aspectRatio).toBe(1);
    expect(thumb.borderRadius).toBe(radius.sm);
    expect(flat(screen.getByText(props.title).props.style).fontSize).toBe(typography.bodyStrong.fontSize);
    expect(textStyle(props.diff).fontSize).toBe(typography.callout.fontSize);
    expect(flat(screen.getByText(updateMetaText(props.meta, 1)).props.style).color).toBe(themes.carbon.color.text.tertiary);
  });

  it('sets tabular figures on the numeric segment of the diff only', async () => {
    await renderUi(<BuildUpdateRow {...props} testID="r" />);
    expect(textStyle(props.diff).fontVariant).toBeUndefined();
    const segment = textStyle('−35 mm');
    expect(segment.fontVariant).toEqual(['tabular-nums']);
    expect(segment.fontSize).toBe(typography.callout.fontSize);
    expect(segment.color).toBe(themes.carbon.color.text.secondary);
  });

  it('keeps a hyphenated diff proportional, so "6-Kolben" does not read "6 - Kolben"', async () => {
    const diff = 'Serie → 6-Kolben · 3-Zoll-Anlage';
    await renderUi(<BuildUpdateRow {...props} diff={diff} testID="r" />);
    expect(textStyle(diff).fontVariant).toBeUndefined();
    expect(screen.queryByText('6-Kolben')).toBeNull();
  });

  it('keeps the short meta whole at a large font too, so it wraps at its "·" (DQ-061), and a short handle whole (DQ-433)', async () => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
    await renderUi(<BuildUpdateRow {...props} testID="r" />);
    expect(screen.getByText(updateMetaText(props.meta, 2)).props.children).toBe('@jann.ptrs\u00A0· vor\u00A02\u00A0Std.');
  });

  it('lets a car name in the meta wrap at its spaces, never inside a word (DQ-291)', async () => {
    const meta = 'Subaru Impreza WRX STI GD · @nico.sti · vor 2 Std.';
    await renderUi(<BuildUpdateRow {...props} meta={meta} testID="r" />);
    expect(screen.getByText(updateMetaText(meta, 1)).props.children).toBe('Subaru Impreza WRX STI GD\u00A0· @nico.sti\u00A0· vor\u00A02\u00A0Std.');
  });

  it('presses as one link', async () => {
    const onPress = jest.fn();
    await renderUi(<BuildUpdateRow {...props} onPress={onPress} testID="r" />);
    await fireEvent.press(screen.getByRole('link', { name: `${props.title}, ${props.diff}, ${props.meta}` }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('MemberRow', () => {
  it('keeps the follow button beside the link, so controls do not nest', async () => {
    const open = jest.fn();
    const follow = jest.fn();
    await renderUi(
      <MemberRow
        name="Lukas Schneider"
        meta="@lukas.sc · Stuttgart"
        onPress={open}
        trailing={<Button label="Folgen" size="m" variant="secondary" onPress={follow} />}
        testID="m"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Folgen' }));
    expect(follow).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('link', { name: 'Lukas Schneider, @lukas.sc · Stuttgart' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('leaves 8 between the pressed fill and the button (DQ-053)', async () => {
    await renderUi(<MemberRow name="Lukas" onPress={jest.fn()} trailing={<Button label="Folgen" size="m" testID="follow" />} testID="m" />);
    expect(flat(screen.getByTestId('follow').parent?.props.style).paddingLeft).toBe(space[8]);
  });

  it('moves the button under the name at a large font', async () => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
    await renderUi(<MemberRow name="Lukas" trailing={<Button label="Folgen" size="m" />} testID="m" />);
    expect(flat(screen.getByTestId('m').props.style).flexDirection).toBe('column');
  });
});

describe('ModRow', () => {
  it('shows name, tabular values, status pill and presses', async () => {
    const onPress = jest.fn();
    await renderUi(<ModRow icon="wheel" name="BBS LM" values="19″ × 9,5J ET35" status="Verbaut" onPress={onPress} testID="m" />);
    expect(flat(screen.getByText('BBS LM').props.style).fontSize).toBe(typography.bodyStrong.fontSize);
    expect(textStyle('19″ × 9,5J ET35').fontVariant).toEqual(['tabular-nums']);
    expect(screen.getByTestId('m.status')).toBeTruthy();
    expect(visualOf('m.body').minHeight).toBe(size.row.single);
    await fireEvent.press(screen.getByRole('link', { name: 'BBS LM, 19″ × 9,5J ET35, Verbaut' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps text values proportional, so the hyphen in "6-Kolben" stays a hyphen', async () => {
    await renderUi(<ModRow icon="brake-disc" name="Brembo GT" values="6-Kolben" />);
    expect(textStyle('6-Kolben').fontVariant).toBeUndefined();
  });

  it('sets tabular figures on the numeric segment of mixed values only, as BuildUpdateRow does (DQ-062)', async () => {
    await renderUi(<ModRow icon="brake-disc" name="Brembo GT" values="6-Kolben · 380 mm" />);
    expect(textStyle('6-Kolben · 380 mm').fontVariant).toBeUndefined();
    expect(textStyle('380 mm').fontVariant).toEqual(['tabular-nums']);
  });

  it('keeps a tyre size whole', async () => {
    await renderUi(<ModRow icon="wheel" name="Michelin" values="265/35 R18" />);
    expect(screen.getByText(/R18/).props.children).toBe('265/\u206035\u00A0R18');
  });

  it('keeps a short hyphenated name whole, a long compound keeps its hyphen to wrap at, the native label stays plain (DQ-047)', async () => {
    await renderUi(<ModRow icon="turbo" name="HKS Hi-Power" onPress={jest.fn()} testID="a" />);
    expect(screen.getByRole('link', { name: 'HKS Hi-Power' })).toBeTruthy();
    expect(screen.getByText('HKS Hi-\u2060Power')).toBeTruthy();
    await renderUi(<ModRow icon="wheel" name="Nismo Aero-Seitenschweller" />);
    expect(screen.getByText('Nismo Aero-Seitenschweller')).toBeTruthy();
  });

  describe('the status pill (DQ-180)', () => {
    const inTextColumn = () => within(screen.getByText('Nismo').parent as never).queryByTestId('m.status') !== null;

    it('trails the row at normal text', async () => {
      await renderUi(<ModRow icon="wheel" name="Nismo" status="Verbaut" onPress={jest.fn()} testID="m" />);
      expect(inTextColumn()).toBe(false);
    });

    it('takes its own line under the text at a large font, and the chevron stays', async () => {
      dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
      await renderUi(<ModRow icon="wheel" name="Nismo" values="Serie" status="Verbaut" onPress={jest.fn()} testID="m" />);
      expect(inTextColumn()).toBe(true);
      expect(screen.getByRole('link', { name: 'Nismo, Serie, Verbaut' })).toBeTruthy();
    });
  });
});

describe('ModRow legal status pill (M2.7 signature, M2.8)', () => {
  const textColumn = () => screen.getByText('BBS LM').parent as never;
  const props = { icon: 'wheel', name: 'BBS LM', values: '19″ × 9,5J ET35', status: 'Verbaut', onPress: jest.fn(), testID: 'm' } as const;

  it('puts the legal pill under the values and keeps the status pill trailing, so the name keeps its width', async () => {
    await renderUi(<ModRow {...props} legalStatus="Teilegutachten" legalStatusLabel="Rechtlicher Status: Teilegutachten" />);
    expect(within(textColumn()).getByTestId('m.legalStatus')).toBeTruthy();
    expect(within(textColumn()).queryByTestId('m.status')).toBeNull();
    expect(screen.getByTestId('m.status')).toBeTruthy();
    expect(screen.getByText('Teilegutachten')).toBeTruthy();
    // The pills wrap onto a further line instead of leaving the column.
    expect(flat(screen.getByTestId('m.pills').props.style)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(screen.getByRole('link', { name: 'BBS LM, 19″ × 9,5J ET35, Verbaut, Rechtlicher Status: Teilegutachten' })).toBeTruthy();
  });

  it('shares the line under the text with the status pill at a large font, and never shortens the name', async () => {
    dimensions.mockReturnValue({ width: 360, height: 780, scale: 1, fontScale: 2 });
    await renderUi(<ModRow {...props} legalStatus="Eintragungsfrei" />);
    const pills = screen.getByTestId('m.pills');
    expect(within(pills).getByTestId('m.status')).toBeTruthy();
    expect(within(pills).getByTestId('m.legalStatus')).toBeTruthy();
    expect(screen.getByText('BBS LM').props.numberOfLines).toBeUndefined();
    expect(screen.getByRole('link', { name: 'BBS LM, 19″ × 9,5J ET35, Verbaut, Eintragungsfrei' })).toBeTruthy();
  });

  it('draws no pill line without a legal status at normal text', async () => {
    await renderUi(<ModRow {...props} />);
    expect(screen.queryByTestId('m.pills')).toBeNull();
    expect(screen.queryByTestId('m.legalStatus')).toBeNull();
  });
});

describe('SpecRow', () => {
  it('is at least 48 high, label secondary, value body.strong', async () => {
    await renderUi(<SpecRow label="Leistung" value="500" unit="PS" testID="s" />);
    expect(flat(screen.getByText('Leistung').props.style).color).toBe(themes.carbon.color.text.secondary);
    const row = screen.getByTestId('s').children[0];
    expect(typeof row === 'string' ? undefined : flat(row?.props.style).minHeight).toBe(space[48]);
    expect(flat(screen.getByTestId('s.value').props.style).fontSize).toBe(typography.bodyStrong.fontSize);
  });

  it('sets numeric values in tabular figures and text values in proportional ones', async () => {
    await renderUi(<SpecRow label="Leistung" value="500" unit="PS" testID="n" />);
    expect(flat(screen.getByTestId('n.value').props.style) as unknown as TextStyle).toMatchObject({ fontVariant: ['tabular-nums'] });
    await renderUi(<SpecRow label="Getriebe" value="6-Gang manuell" testID="t" />);
    expect(flat(screen.getByTestId('t.value').props.style) as unknown as TextStyle).toMatchObject({ fontVariant: ['proportional-nums'] });
  });

  it('shows provenance only when given', async () => {
    await renderUi(<SpecRow label="Leistung" value="500" testID="a" />);
    expect(screen.queryByTestId('a.provenance')).toBeNull();
    await renderUi(<SpecRow label="Leistung" value="500" provenance="Prüfstand" testID="b" />);
    expect(flat(screen.getByTestId('b.provenance').props.style).color).toBe(themes.carbon.color.text.tertiary);
  });

  it('exposes no control', async () => {
    await renderUi(<SpecRow label="Leistung" value="500" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('ListRow', () => {
  it('is 56 single and 72 with a subtitle or thumb', async () => {
    await renderUi(<ListRow title="Sprache" onPress={jest.fn()} testID="a" />);
    expect(visualOf('a.body').minHeight).toBe(size.row.single);
    await renderUi(<ListRow title="Sprache" subtitle="Deutsch" onPress={jest.fn()} testID="b" />);
    expect(visualOf('b.body').minHeight).toBe(size.row.withThumb);
    await renderUi(<ListRow title="Entwurf" thumb={{ source: 'https://x/a.webp' }} onPress={jest.fn()} testID="c" />);
    expect(visualOf('c.body').minHeight).toBe(size.row.withThumb);
  });

  it('names the row from its text and presses', async () => {
    const onPress = jest.fn();
    await renderUi(<ListRow title="Sprache" value="Deutsch" icon="info" onPress={onPress} testID="a" />);
    expect(flat(screen.getByTestId('a.value').props.style).color).toBe(themes.carbon.color.text.secondary);
    await fireEvent.press(screen.getByRole('link', { name: 'Sprache, Deutsch' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not press when disabled', async () => {
    const onPress = jest.fn();
    await renderUi(<ListRow title="Sprache" disabled onPress={onPress} testID="a" />);
    await fireEvent.press(screen.getByTestId('a.body'));
    expect(onPress).not.toHaveBeenCalled();
    expect(flat(screen.getByText('Sprache').props.style).color).toBe(themes.carbon.color.text.disabled);
  });

  it('uses the destructive colour', async () => {
    await renderUi(<ListRow title="QR-Code ersetzen" destructive onPress={jest.fn()} />);
    expect(flat(screen.getByText('QR-Code ersetzen').props.style).color).toBe(themes.carbon.color.accent.fg);
  });

  it('keeps a control beside the pressable part', async () => {
    const onChange = jest.fn();
    await renderUi(<ListRow title="Öffentlich" control={<Switch label="Öffentlich" value={false} onValueChange={onChange} testID="sw" />} />);
    expect(screen.queryByRole('link')).toBeNull();
    await fireEvent.press(screen.getByTestId('sw'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('ListRow adaptive value (DQ-152)', () => {
  const geometry = { inner: 300, lead: 32, titleWord: 80, subtitleWord: 60, value: 60, chevron: true };

  it('keeps the value beside while every word of the text fits its column', () => {
    // 300 − 32 − 12 − (60 + 8 + 16) = 172 for the text.
    expect(adaptiveValueStacks(geometry)).toBe(false);
    expect(adaptiveValueStacks({ ...geometry, titleWord: 172 })).toBe(false);
  });

  it('stacks before a word would break inside its letters, or when the value takes more than half', () => {
    expect(adaptiveValueStacks({ ...geometry, titleWord: 173 })).toBe(true);
    expect(adaptiveValueStacks({ ...geometry, subtitleWord: 173 })).toBe(true);
    expect(adaptiveValueStacks({ ...geometry, value: 140 })).toBe(true);
  });

  it('waits for all its measures', () => {
    expect(adaptiveValueStacks({ ...geometry, inner: 0 })).toBeNull();
    expect(adaptiveValueStacks({ ...geometry, titleWord: 0 })).toBeNull();
    expect(adaptiveValueStacks({ ...geometry, value: 0 })).toBeNull();
  });

  it('finds the longest run between breakable spaces, keeping no-break spaces and word joiners together', () => {
    expect(longestWord('BMW M3 E30')).toBe('BMW');
    expect(longestWord('Entwurf · Schritt 2 von 4')).toBe('Schritt 2 von 4');
    expect(longestWord('Nissan Skyline GT-⁠R R34')).toBe('Skyline');
  });

  it('moves the value under the subtitle once the measured row is too narrow', async () => {
    await renderUi(<ListRow title="BMW M3 E30" subtitle="Entwurf · Schritt 2 von 4" value="Fortsetzen" adaptiveValue onPress={jest.fn()} inset={16} testID="d" />);
    // Beside until measured: the value trails, right-aligned.
    expect((flat(screen.getByTestId('d.value').props.style) as TextStyle).textAlign).toBe('right');
    const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } } });
    await fireEvent(screen.getByTestId('d'), 'layout', layout(230));
    const hidden = { includeHiddenElements: true };
    await fireEvent(screen.getByTestId('d.measure.title', hidden), 'layout', layout(40));
    await fireEvent(screen.getByTestId('d.measure.subtitle', hidden), 'layout', layout(100));
    await fireEvent(screen.getByTestId('d.measure.value', hidden), 'layout', layout(72));
    // 230 − 2 × 16 − 12 − (72 + 8 + 16) = 90 < 100: "Schritt 2 von 4" would split, so the value takes its own line.
    expect((flat(screen.getByTestId('d.value').props.style) as TextStyle).textAlign).toBeUndefined();
    expect(screen.getByTestId('d.value')).toHaveTextContent('Fortsetzen');
  });
});

describe('BuildUpdateRowSkeleton', () => {
  /** The height of the row: its padding plus the height of every line box of the three texts. */
  function skeletonHeight() {
    const text = screen.getByTestId('skel.text');
    const blocks = text.children.filter((child) => typeof child !== 'string');
    const lines = blocks.flatMap((block) => (typeof block === 'string' ? [] : block.children));
    const textHeight = lines.reduce((sum, line) => sum + (typeof line === 'string' ? 0 : Number(flat(line.props.style).height)), 0);
    return textHeight + 2 * space[12];
  }

  // The text column of DEV-01.rows.update, measured live: 228 at 360, 250 at 390, 290 at 430, 540 from 768 up. The heights
  // are the 2.0 line boxes (body.strong 22, callout 20, caption 16, plus 2 × 12): v1 counted 24 for the title. At 200 % the
  // title "Fahrwerk geändert" is 276 wide in Inter 600 at 30 (TTF advances, M4.1), so the 290 column now holds it on one line.
  it.each([
    [1, 228, 82],
    [1.3, 228, 99.4],
    [1.5, 228, 141],
    [2, 228, 256],
    [1, 250, 82],
    [1.3, 250, 99.4],
    [1.5, 250, 141],
    [2, 250, 256],
    [1, 290, 82],
    [1.3, 290, 99.4],
    [1.5, 290, 111],
    [2, 290, 180],
    [1.5, 540, 111],
    [2, 540, 140],
  ])('at font scale %s and a text column of %i it is %i high, the height of the real row', async (fontScale, width, height) => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale });
    await renderUi(
      <Skeleton>
        <BuildUpdateRowSkeleton testID="skel" />
      </Skeleton>,
    );
    await fireEvent(screen.getByTestId('skel.text'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 60 } } });
    expect(skeletonHeight()).toBeCloseTo(height);
  });


  it('takes the geometry of the real row: same row style and the line boxes of its three texts', async () => {
    await renderUi(
      <>
        <BuildUpdateRow title="Fahrwerk geändert" diff="Serie → KW V3" meta="@jann.ptrs" photo={{ source: 1, blurhash: 'L' }} testID="real" />
        <BuildUpdateRowSkeleton testID="skel" />
      </>,
    );
    const real = flat(screen.getByTestId('real.body').props.style);
    const skeleton = flat(screen.getByTestId('skel.row').props.style);
    expect(skeleton).toEqual(real);
    const lines = typography.bodyStrong.lineHeight + typography.callout.lineHeight + typography.caption.lineHeight;
    expect(lines).toBe(58);
    expect(lines + (skeleton.paddingVertical as number) * 2).toBe(82);
  });
});

describe('OwnerRow', () => {
  const actions = <Button label="Folgen" size="m" variant="secondary" />;

  const rowWidth = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 64 } } });

  it('gives the pressed fill the corners of the focus ring around it (DQ-053)', async () => {
    await renderUi(<OwnerRow name="Lukas" meta="@lukas.sc" onPress={jest.fn()} testID="o" />);
    expect(visualOf('o.identity').borderRadius).toBe(radius.sm);
  });

  it('decides by its own measured width: inline from 438, stacked below', async () => {
    dimensions.mockReturnValue({ width: 1280, height: 800, scale: 1, fontScale: 1 });
    await renderUi(<OwnerRow name="Lukas" meta="@lukas.sc · Stuttgart" actions={actions} testID="o" />);
    const row = () => flat(screen.getByTestId('o').props.style).flexDirection;
    expect(row()).toBe('row');
    await fireEvent(screen.getByTestId('o'), 'layout', rowWidth(437));
    expect(row()).toBeUndefined();
    await fireEvent(screen.getByTestId('o'), 'layout', rowWidth(438));
    expect(row()).toBe('row');
    expect(screen.getByTestId('o.actions')).toBeTruthy();
  });

  it('trails one measured action where it fits, and stacks only where it does not (DQ-262)', async () => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
    await renderUi(<OwnerRow name="Jann" meta="@jann.ptrs · Hamburg" actions={actions} inset={0} testID="o" />);
    const row = () => flat(screen.getByTestId('o').props.style).flexDirection;
    const width = (value: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: value, height: 44 } } });
    // Before anything is measured the two-button width stands in.
    expect(row()).toBeUndefined();
    await fireEvent(screen.getByTestId('o.actions'), 'layout', width(84));
    await fireEvent(screen.getByTestId('o'), 'layout', rowWidth(350));
    expect(row()).toBe('row');
    // 40 + 12 + 140 + 12 + 84 = 288: a 280-wide row stacks.
    await fireEvent(screen.getByTestId('o'), 'layout', rowWidth(280));
    expect(row()).toBeUndefined();
  });

  it('lays the row out for the widest state, so following never flips it (DQ-262)', async () => {
    dimensions.mockReturnValue({ width: 360, height: 780, scale: 1, fontScale: 1 });
    const widest = <Button label="Folge ich" icon="check" size="m" variant="secondary" disabled />;
    await renderUi(<OwnerRow name="Jann" meta="@jann.ptrs" actions={actions} widestActions={widest} inset={0} testID="o" />);
    const row = () => flat(screen.getByTestId('o').props.style).flexDirection;
    const width = (value: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: value, height: 44 } } });
    await fireEvent(screen.getByTestId('o.actions'), 'layout', width(84));
    // Hidden from assistive technology, so the query has to ask for hidden elements.
    const measure = () => screen.getByTestId('o.measure', { includeHiddenElements: true });
    await fireEvent(measure(), 'layout', width(136));
    // "Folgen" alone would fit 320 (288), "✓ Folge ich" does not (340): the 360 phone stacks in both states.
    await fireEvent(screen.getByTestId('o'), 'layout', rowWidth(320));
    expect(row()).toBeUndefined();
    await fireEvent(screen.getByTestId('o'), 'layout', rowWidth(350));
    expect(row()).toBe('row');
    expect(measure().props['aria-hidden']).toBe(true);
    expect(screen.queryByTestId('o.measure')).toBeNull();
  });

  it('never hyphenates or breaks the username from its separator', async () => {
    await renderUi(<OwnerRow name="Lukas" meta="@lukas.sc · Stuttgart" actions={actions} testID="o" />);
    expect(screen.getByText('@lukas.sc\u00A0· Stuttgart')).toBeTruthy();
  });

  it.each([
    ['in a phone window', { width: 430, height: 800, scale: 1, fontScale: 1 }],
    ['at a large font', { width: 1280, height: 800, scale: 1, fontScale: 2 }],
  ])('moves the actions under the name %s', async (_, window) => {
    dimensions.mockReturnValue(window);
    await renderUi(<OwnerRow name="Lukas" actions={actions} testID="o" />);
    expect(flat(screen.getByTestId('o').props.style).flexDirection).toBeUndefined();
  });

  it('makes the identity box taller than its text stack, so fill and focus ring clear the content', async () => {
    await renderUi(<OwnerRow name="Lukas" meta="@lukas.sc" onPress={jest.fn()} testID="o" />);
    const box = visualOf('o.identity');
    const stack = typography.bodyStrong.lineHeight + typography.callout.lineHeight;
    // body.strong 22 + callout 20 (v1: label 20 + supporting 20 = 40, so 60 then), 8 around.
    expect(stack + (box.padding as number) * 2).toBe(58);
    expect(box.padding as number).toBeGreaterThan(size.border.focusRing + size.border.focusOffset);
    // The margin gives the padding back: the avatar stays on the gutter, the row keeps its FS-3 rhythm.
    expect(flat(screen.getByTestId('o.identity').props.style).margin).toBe(-(box.padding as number));
  });

  it('opens the profile from the identity', async () => {
    const onPress = jest.fn();
    await renderUi(<OwnerRow name="Lukas" meta="@lukas.sc" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('link', { name: 'Lukas, @lukas.sc' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
