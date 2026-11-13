import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference, size, themes, typography } from '@/theme';
import { ContentTabs, tabRowOffset } from '@/ui/ContentTabs';

import { flat, renderUi, visualOf } from './helpers';

beforeAll(hydrateThemePreference);

const tabs = [
  { value: 'overview', label: 'Übersicht' },
  { value: 'tech', label: 'Technik' },
  { value: 'mods', label: 'Mods' },
  { value: 'log', label: 'Verlauf', disabled: true },
] as const;

describe('ContentTabs', () => {
  it('tabs sit in a tablist, 44 high', async () => {
    await renderUi(<ContentTabs tabs={tabs} value="tech" onChange={jest.fn()} label="Fahrzeug" testID="t" />);
    expect(screen.getByTestId('t.list').props.role).toBe('tablist');
    expect(screen.getByTestId('t.list').props['aria-label']).toBe('Fahrzeug');
    expect(screen.getByRole('tab', { name: 'Technik' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('tab', { name: 'Mods' }).props.accessibilityState.selected).toBe(false);
    expect(visualOf('t.tech').minHeight).toBe(size.contentTab);
  });

  it('label is body.strong (15/22 semi-bold), active text.primary, others text.secondary', async () => {
    await renderUi(<ContentTabs tabs={tabs} value="tech" onChange={jest.fn()} label="Fahrzeug" testID="t" />);
    const active = flat(screen.getByText('Technik').props.style) as ReturnType<typeof flat> & { fontFamily?: string };
    expect(active.fontSize).toBe(typography.bodyStrong.fontSize);
    expect(active.lineHeight).toBe(typography.bodyStrong.lineHeight);
    expect(active.fontFamily).toBe(typography.bodyStrong.fontFamily);
    expect(active.color).toBe(themes.carbon.color.text.primary);
    expect(flat(screen.getByText('Mods').props.style).color).toBe(themes.carbon.color.text.secondary);
  });

  it('selects on press, ignores the selected and disabled tabs', async () => {
    const onChange = jest.fn();
    await renderUi(<ContentTabs tabs={tabs} value="tech" onChange={onChange} label="Fahrzeug" testID="t" />);
    await fireEvent.press(screen.getByTestId('t.tech'));
    await fireEvent.press(screen.getByTestId('t.log'));
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('t.mods'));
    expect(onChange).toHaveBeenCalledWith('mods');
  });

  it('arrow keys wrap around and skip disabled tabs', async () => {
    const onChange = jest.fn();
    await renderUi(<ContentTabs tabs={tabs} value="mods" onChange={onChange} label="Fahrzeug" testID="t" />);
    await fireEvent(screen.getByTestId('t.list'), 'keyDown', { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('overview');
  });

  it('only the selected tab is a tab stop', async () => {
    await renderUi(<ContentTabs tabs={tabs} value="tech" onChange={jest.fn()} label="Fahrzeug" testID="t" />);
    expect(screen.getByTestId('t.tech').props.tabIndex).toBe(0);
    expect(screen.getByTestId('t.mods').props.tabIndex).toBe(-1);
  });
});

describe('tabRowOffset (DQ-1089, DQ-1115)', () => {
  // Four tabs of 100 each from x 0, as the row lays them out.
  const boxes = [0, 100, 200, 300].map((x) => ({ x, width: 100 }));

  it('stays at the start while the selected tab fits', () => {
    expect(tabRowOffset(boxes, 0, 250, 0)).toBe(0);
    expect(tabRowOffset(boxes, 1, 250, 0)).toBe(0);
  });

  it('starts at a whole tab, never inside one, so the first tab in view is never cut', () => {
    // The third tab ends at 300: from 100 it fits in 250, from 0 it does not.
    expect(tabRowOffset(boxes, 2, 250, 0)).toBe(100);
    expect(tabRowOffset(boxes, 3, 250, 0)).toBe(200);
  });

  it('keeps the trailing inset', () => {
    expect(tabRowOffset(boxes, 1, 210, 10)).toBe(100);
    expect(tabRowOffset(boxes, 1, 220, 10)).toBe(0);
  });

  it('falls back to the selected tab when it is wider than the row', () => {
    expect(tabRowOffset([{ x: 0, width: 100 }, { x: 100, width: 400 }], 1, 250, 0)).toBe(100);
    expect(tabRowOffset(boxes, 2, 0, 0)).toBe(0);
  });
});
