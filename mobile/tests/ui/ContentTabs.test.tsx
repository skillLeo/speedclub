import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference, size, themes, typography } from '@/theme';
import { ContentTabs } from '@/ui/ContentTabs';

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

  it('label is 15/20 semi-bold, active text.primary, others text.secondary', async () => {
    await renderUi(<ContentTabs tabs={tabs} value="tech" onChange={jest.fn()} label="Fahrzeug" testID="t" />);
    const active = flat(screen.getByText('Technik').props.style) as ReturnType<typeof flat> & { fontFamily?: string };
    expect(active.fontSize).toBe(15);
    expect(active.lineHeight).toBe(20);
    expect(active.fontFamily).toBe(typography.labelS.fontFamily);
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
