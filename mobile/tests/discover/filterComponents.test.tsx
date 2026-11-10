import { fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { FilterChipRow } from '@/features/discover/components/FilterChipRow';
import { FilterPanel } from '@/features/discover/components/FilterPanel';
import { PickerList } from '@/features/discover/components/PickerList';
import { PINNED_SHARE, tableLayout, tableNaturalWidth, WheelSetupCard, WheelSetupTable, wheelTableFits, type WheelTableRow } from '@/features/discover/components/WheelSetupTable';
import { EMPTY_FILTERS, parseSearchParams, type FilterOptions } from '@/features/discover/filters';
import i18n from '@/i18n';
import { hydrateThemePreference, layout, size } from '@/theme';

import { renderWithProviders } from '../home/harness';

const mockFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 1, fontScale: mockFontScale.current }),
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()) }));

const OPTIONS: FilterOptions = {
  make: [
    { value: 'bmw', label: 'BMW', count: 12 },
    { value: 'audi', label: 'Audi', count: 7 },
  ],
  drivetrain: [
    { value: 'awd', label: 'Allrad', count: 9 },
    { value: 'rwd', label: 'Heckantrieb', count: 4 },
  ],
  wheel_diameter: [
    { value: '19', label: '19', count: 8 },
    { value: '19.5', label: '19.5', count: 1 },
  ],
  wheel_brand: [{ value: 'bbs', label: 'BBS', count: 5 }],
};

async function renderPanel(overrides: Partial<Parameters<typeof FilterPanel>[0]> = {}) {
  const onChange = jest.fn();
  const onOpenPicker = jest.fn();
  await renderWithProviders(
    <FilterPanel
      filters={EMPTY_FILTERS}
      onChange={onChange}
      options={OPTIONS}
      status="ready"
      onRetry={jest.fn()}
      onOpenPicker={onOpenPicker}
      makeLabel={null}
      modelLabel={null}
      testID="DISC-02.filters"
      {...overrides}
    />,
  );
  return { onChange, onOpenPicker };
}

beforeAll(async () => {
  await hydrateThemePreference();
  await i18n.changeLanguage('de');
});

describe('the filter panel (FS-11)', () => {
  it('DQ-449: an active generation keeps its group and its selected chip, also when the facets have not listed it', async () => {
    const filters = { ...EMPTY_FILTERS, make: 'nissan', model: 'nissan--skyline-gt-r', generation: 'r34' };
    for (const generation of [[], [{ value: 'r33', label: 'R33', count: 2 }]]) {
      const { onChange } = await renderPanel({ filters, options: { ...OPTIONS, generation }, generationLabel: 'R34', makeLabel: 'Nissan', modelLabel: 'Skyline GT-R' });
      const chip = screen.getByTestId('DISC-02.filters.generation.r34');
      expect(chip).toBeChecked();
      expect(chip).toHaveTextContent('R34', { exact: false });
      await fireEvent.press(chip);
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ generation: null }));
    }
  });


  it('shows the real facet count on every option, and sizes as "19,5″"', async () => {
    await renderPanel();
    expect(screen.getByTestId('DISC-02.filters.drivetrain.awd')).toHaveTextContent('Allrad9');
    expect(screen.getByTestId('DISC-02.filters.drivetrain.rwd')).toHaveTextContent('Heckantrieb4');
    expect(screen.getByTestId('DISC-02.filters.wheel_diameter.19.5')).toHaveTextContent('19,5″1');
    expect(screen.getByTestId('DISC-02.filters.wheel_brand.bbs')).toHaveTextContent('BBS5');
  });

  it('leaves out a group the results have no value for, and keeps an active value that has none left', async () => {
    await renderPanel({ filters: parseSearchParams({ fuel: 'diesel' }).filters });
    expect(screen.queryByTestId('DISC-02.filters.exhaust')).toBeNull();
    expect(screen.getByTestId('DISC-02.filters.fuel.diesel')).toBeChecked();
  });

  it('toggles a value and opens the make picker', async () => {
    const { onChange, onOpenPicker } = await renderPanel();
    await fireEvent.press(screen.getByTestId('DISC-02.filters.drivetrain.awd'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ drivetrain: ['awd'] }));
    await fireEvent.press(screen.getByTestId('DISC-02.filters.make'));
    expect(onOpenPicker).toHaveBeenCalledWith('make');
  });

  it('asks for a make before the model', async () => {
    const { onOpenPicker } = await renderPanel();
    expect(screen.getByText('Wähle zuerst eine Marke.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('DISC-02.filters.model'));
    expect(onOpenPicker).not.toHaveBeenCalled();
  });

  it('hands up a typed year as soon as it is a year, and refuses one outside the catalogue', async () => {
    const { onChange } = await renderPanel();
    await fireEvent.changeText(screen.getByTestId('DISC-02.filters.yearMin'), '201');
    expect(screen.queryByText(/Gib ein Jahr zwischen 1900/)).toBeNull();
    await fireEvent.changeText(screen.getByTestId('DISC-02.filters.yearMin'), '1850');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Gib ein Jahr zwischen 1900/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('DISC-02.filters.yearMin'), '2015');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ year: { min: 2015, max: null } }));
  });

  it('hands up every slider step at once, snapped, so a draft never misses the last one', async () => {
    const { onChange } = await renderPanel();
    const low = screen.getByTestId('DISC-02.filters.power.low');
    await fireEvent(low, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(low, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ power: { min: 70, max: null } }));
  });

  it('names each facet group by its field', async () => {
    await renderPanel();
    expect(screen.getByLabelText('Felgendurchmesser')).toHaveProp('role', 'group');
  });

  it('says when the facets cannot load, with a retry', async () => {
    const onRetry = jest.fn();
    await renderPanel({ status: 'error', onRetry });
    await fireEvent.press(screen.getByTestId('DISC-02.filters.retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('the make picker', () => {
  it('lists the makes with their counts, "Alle Marken" first, and narrows by name', async () => {
    const onPick = jest.fn();
    const many = Array.from({ length: 12 }, (_, index) => ({ value: `make-${index}`, label: index === 3 ? 'Citroën' : `Marke ${index}`, count: index + 1 }));
    await renderWithProviders(<PickerList field="make" options={many} value={null} onPick={onPick} testID="DISC-02.picker.make" />);
    expect(screen.getByTestId('DISC-02.picker.make.all')).toBeChecked();
    expect(screen.getByTestId('DISC-02.picker.make.make-3.count')).toHaveTextContent('4');
    await fireEvent.changeText(screen.getByTestId('DISC-02.picker.make.search'), 'citroen');
    expect(screen.queryByTestId('DISC-02.picker.make.make-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('DISC-02.picker.make.make-3'));
    expect(onPick).toHaveBeenCalledWith('make-3');
  });
});

describe('the chip row', () => {
  it('shows "Filter" with the active count and removes a chip by its ×', async () => {
    const onRemove = jest.fn();
    const onOpenFilters = jest.fn();
    await renderWithProviders(
      <FilterChipRow chips={[{ id: 'make:bmw', label: 'BMW', onRemove }]} count={1} onOpenFilters={onOpenFilters} gutter={16} testID="DISC-02.chips" />,
    );
    expect(screen.getByTestId('DISC-02.chips.filter')).toHaveTextContent('Filter1');
    await fireEvent.press(screen.getByTestId('DISC-02.chips.filter'));
    expect(onOpenFilters).toHaveBeenCalled();
    expect(screen.getByLabelText('BMW entfernen')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('DISC-02.chips.make.bmw.remove'));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('the wheel-setup comparison', () => {
  const ROW: WheelTableRow = {
    id: 'v1',
    slug: 'bmw-m4-competition-g82-ab12',
    title: 'BMW M4 Competition',
    owner: '@jann.ptrs',
    thumb: { source: null },
    cells: {
      wheel: 'Rays Volk Racing TE37 SL',
      size: '19″ × 9,5J vorne · 20″ × 10,5J hinten',
      et: 'ET35',
      tyres: '275/35 R19 vorne · 285/30 R20 hinten',
      suspension: 'KW V3',
      lowering: '−30 mm',
    },
  };

  it('from 768 is a table with column headers and a row header per build, and opens the build', async () => {
    const onOpen = jest.fn();
    await renderWithProviders(<WheelSetupTable rows={[ROW]} caption="Räder-Vergleich BMW M4" onOpen={onOpen} testID="DISC-04.wheels" />);
    expect(screen.getByTestId('DISC-04.wheels')).toHaveProp('role', 'table');
    expect(screen.getByTestId('DISC-04.wheels.v1')).toHaveProp('role', 'row');
    expect(screen.getByTestId('DISC-04.wheels.v1.et')).toHaveTextContent('ET35');
    expect(screen.getByText('Tieferlegung')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('DISC-04.wheels.v1.open'));
    expect(onOpen).toHaveBeenCalledWith(ROW);
  });

  it('fills a wide pane without scrolling, and pins at most 40 % of a narrow one at any font', () => {
    const wide = tableLayout(1150, 1);
    expect(wide.pinned).toBe(false);
    expect(wide.build + Object.values(wide.widths).reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(1150);
    const narrow = tableLayout(720, 2);
    expect(narrow.pinned).toBe(true);
    expect(narrow.build).toBeLessThanOrEqual(720 * PINNED_SHARE);
  });

  it('DQ-436: the table only where every column fits whole: the 1280 pane at 1×; cards at 768, 1024 and at 2× (no clipped column)', () => {
    const room = (window: number, chrome: number, gutter: number) => Math.min(layout.contentMax, window - chrome) - 2 * gutter;
    expect(wheelTableFits(room(1280, layout.sidebar, 24), 1)).toBe(true);
    expect(wheelTableFits(room(1440, layout.sidebar, 24), 1)).toBe(true);
    expect(wheelTableFits(room(1024, layout.rail, 24), 1)).toBe(false);
    expect(wheelTableFits(room(768, layout.rail, 24), 1)).toBe(false);
    expect(wheelTableFits(room(1280, layout.sidebar, 24), 2)).toBe(false);
    // Where it fits, it never pins or scrolls: the columns share out the spare width.
    const fit = tableLayout(room(1280, layout.sidebar, 24) - 2 * size.border.control, 1);
    expect(fit.pinned).toBe(false);
    expect(tableNaturalWidth(1)).toBeLessThanOrEqual(room(1280, layout.sidebar, 24));
  });

  it('DQ-447: a table that fits fills its frame to the pixel, the last column taking what rounding left', () => {
    for (const width of [990, 1150, 1349]) {
      const fit = tableLayout(width, 1);
      expect(fit.build + Object.values(fit.widths).reduce((sum, column) => sum + column, 0)).toBe(width);
    }
  });

  it('DQ-448: at twice the size each label stands above its value and never hyphenates', async () => {
    mockFontScale.current = 2;
    try {
      await renderWithProviders(<WheelSetupCard row={ROW} onOpen={jest.fn()} testID="DISC-04.wheels" />);
      const row = StyleSheet.flatten(screen.getByTestId('DISC-04.wheels.v1.lowering.row').props.style);
      expect(row.flexDirection ?? 'column').toBe('column');
      const label = screen.getByTestId('DISC-04.wheels.v1.lowering.label');
      expect((StyleSheet.flatten(label.props.style) as { hyphens?: string }).hyphens).not.toBe('auto');
    } finally {
      mockFontScale.current = 1;
    }
  });

  it('below 768 is one card per build, names wrapping at their spaces, and the link says the owner too', async () => {
    await renderWithProviders(<WheelSetupCard row={ROW} onOpen={jest.fn()} testID="DISC-04.wheels" />);
    expect(screen.getByTestId('DISC-04.wheels.v1.wheel')).toHaveTextContent('Rays Volk Racing TE37 SL');
    expect(screen.getByLabelText('BMW M4 Competition, @jann.ptrs')).toBeTruthy();
  });

  it('the build link is a real 44 target, not a 40 thumb with hit slop (M2.8 round 2)', async () => {
    await renderWithProviders(<WheelSetupCard row={ROW} onOpen={jest.fn()} testID="DISC-04.wheels" />);
    const link = screen.getByTestId('DISC-04.wheels.v1.open');
    expect(StyleSheet.flatten(link.props.style)).toEqual(expect.objectContaining({ minHeight: size.touchMin }));
    expect(link.props.hitSlop).toBeUndefined();
  });
});
