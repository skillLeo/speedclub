import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference, space, typography } from '@/theme';
import { SectionHeader } from '@/ui/SectionHeader';

import { flat, renderUi, visualOf } from './helpers';

beforeAll(hydrateThemePreference);

describe('SectionHeader', () => {
  it('is a headline heading', async () => {
    await renderUi(<SectionHeader title="Neue Builds" />);
    expect(flat(screen.getByText('Neue Builds').props.style).fontSize).toBe(typography.headline.fontSize);
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

  // BUG-2: on Android the wrapped header's action grew to the height of everything after it, because its visual grew inside a
  // target that hugs its label. In every placement (beside, wrapped, stacked) the action's visual sizes from its label.
  it('never lets the action grow past its own height, beside, wrapped or stacked (BUG-2)', async () => {
    await renderUi(
      <>
        <SectionHeader title="Neue Builds" actionLabel="Alle" onAction={jest.fn()} testID="plain" />
        <SectionHeader title="Highlights" actionLabel="Alle Mods (14)" onAction={jest.fn()} wraps testID="w" />
      </>,
    );
    expect(visualOf('plain.action').flexGrow).toBeUndefined();
    expect(visualOf('w.action').flexGrow).toBeUndefined();
    const layout = (y: number, height: number) => ({ nativeEvent: { layout: { x: 0, y, width: 100, height } } });
    await fireEvent(screen.getByText('Highlights'), 'layout', layout(0, 24));
    let wrapper = screen.getByTestId('w.action').parent;
    while (wrapper && typeof wrapper.props.onLayout !== 'function') wrapper = wrapper.parent;
    await fireEvent(wrapper!, 'layout', layout(32, 36));
    expect(visualOf('w.action').flexGrow).toBeUndefined();
  });
});
