import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference, space, typography } from '@/theme';
import { SectionHeader } from '@/ui/SectionHeader';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('SectionHeader', () => {
  it('is a title.s heading', async () => {
    await renderUi(<SectionHeader title="Neue Builds" />);
    expect(flat(screen.getByText('Neue Builds').props.style).fontSize).toBe(typography.titleS.fontSize);
    expect(screen.getByText('Neue Builds').props.role).toBe('heading');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('runs the trailing action', async () => {
    const onAction = jest.fn();
    await renderUi(<SectionHeader title="Neue Builds" actionLabel="Alle" actionAccessibilityLabel="Alle neuen Builds" onAction={onAction} testID="h" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Alle neuen Builds' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('h.action')).toBeTruthy();
  });

  it('lets the action overhang the title line, so title to content stays 12 (DQ-298)', async () => {
    await renderUi(<SectionHeader title="Neue Builds" actionLabel="Alle" onAction={jest.fn()} testID="h" />);
    // Button S is 36 and the title line 24: 4 above and 8 below take the difference, both on the spacing scale.
    expect(flat(screen.getByTestId('h.action').props.style)).toMatchObject({ marginTop: -space[4], marginBottom: -space[8] });
  });

  it('keeps a wrapped action on a line of its own at its full height (DQ-110)', async () => {
    await renderUi(<SectionHeader title="Highlights" actionLabel="Alle Mods (14)" onAction={jest.fn()} wraps testID="w" />);
    const wrapper = () => {
      let node = screen.getByTestId('w.action').parent;
      while (node && typeof node.props.onLayout !== 'function') node = node.parent;
      return node!;
    };
    // Beside the title it overhangs like the plain action.
    expect(flat(wrapper().props.style)).toMatchObject({ marginTop: -space[4], marginBottom: -space[8] });
    const layout = (y: number, height: number) => ({ nativeEvent: { layout: { x: 0, y, width: 100, height } } });
    await fireEvent(screen.getByText('Highlights'), 'layout', layout(0, 24));
    await fireEvent(wrapper(), 'layout', layout(32, 36));
    // Under it, the line is the button's own 36.
    expect(flat(wrapper().props.style).marginTop).toBeUndefined();
    expect(flat(wrapper().props.style).marginBottom).toBeUndefined();
  });
});
