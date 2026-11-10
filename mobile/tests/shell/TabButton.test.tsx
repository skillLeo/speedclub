/** The tab button outside the router: focus ring per variant and where the unread count sits. */
import { screen } from '@testing-library/react-native';

import { NARROW_CELL_CAP, TabButton, type TabButtonVariant } from '@/features/shell/TabButton';
import { hydrateThemePreference, radius, size, space } from '@/theme';
import { ForcedVisualStateProvider } from '@/ui/qaVisualState';

import { flat, renderUi, visualOf } from '../ui/helpers';

beforeAll(hydrateThemePreference);

const renderButton = (variant: TabButtonVariant, count?: number, focused = false) =>
  renderUi(
    <ForcedVisualStateProvider value={{ focused }}>
      <TabButton variant={variant} icon="chats" label="Nachrichten" count={count} testID="t" />
    </ForcedVisualStateProvider>,
  );

describe('forced keyboard focus', () => {
  // The bar's bottom edge meets the viewport and its cells meet each other, the rail meets the window edge and divider.
  it.each(['bar', 'rail'] as const)('%s: the ring is inset, radius 8, inside the 64 cell', async (variant) => {
    await renderButton(variant, undefined, true);
    const visual = visualOf('t');
    expect(visual.outlineOffset).toBe(-size.border.focusRing);
    expect(visual.outlineWidth).toBe(size.border.focusRing);
    expect(visual.borderRadius).toBe(radius.sm);
    expect(flat(screen.getByTestId('t').props.style).height).toBe(size.tabBar);
  });

  it('sidebar: the ring stays outside, it has the 12 of padding for it', async () => {
    await renderButton('sidebar', undefined, true);
    expect(visualOf('t').outlineOffset).toBe(size.border.focusOffset);
  });

  it('no ring without focus', async () => {
    await renderButton('bar');
    expect(visualOf('t').outlineWidth).toBeUndefined();
  });
});

describe('unread count', () => {
  it.each(['bar', 'rail'] as const)('%s: the pill sits on the icon', async (variant) => {
    await renderButton(variant, 100);
    const pill = flat(screen.getByTestId('t.badge', { includeHiddenElements: true }).props.style);
    expect(pill.position).toBe('absolute');
    expect(pill.left).toBe('50%');
    expect(pill.top).toBe(space[8]);
  });

  it('sidebar: the pill is at the end of the row, centred, in the flow, so 99+ cannot touch the label', async () => {
    await renderButton('sidebar', 100);
    const pill = flat(screen.getByTestId('t.badge', { includeHiddenElements: true }).props.style);
    expect(pill.position).toBeUndefined();
    expect(pill.alignSelf).toBe('center');
    expect(pill.flexShrink).toBe(0);
    expect(flat(screen.getByText('Nachrichten').props.style).flex).toBe(1);
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeTruthy();
  });

  it('the name of the tab holds the visible text in its order, and the pill itself stays silent', async () => {
    await renderButton('bar', 128);
    expect(screen.getByRole('tab', { name: 'Nachrichten, 99+ ungelesen' })).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    // Without the space the text of the two boxes reads "Nachrichten99+", which is not in the name.
    expect(screen.getByText('Nachrichten ', { normalizer: (text) => text })).toBeTruthy();
  });

  it('none for zero', async () => {
    await renderButton('sidebar', 0);
    expect(screen.queryByTestId('t.badge', { includeHiddenElements: true })).toBeNull();
  });
});

describe('the DOM audit exemption of a capped label (ADR-145, M2.8)', () => {
  it('a bar label held at 1.15 carries tab-label; uncapped and sidebar labels do not', async () => {
    await renderUi(<TabButton variant="bar" icon="chats" label="Nachrichten" labelCap={NARROW_CELL_CAP} testID="capped" />);
    expect(screen.getByText('Nachrichten').props.dataSet).toEqual({ qaExempt: 'tab-label' });
    await renderUi(<TabButton variant="bar" icon="chats" label="Garage" testID="free" />);
    expect(screen.getByText('Garage').props.dataSet).toBeUndefined();
    await renderUi(<TabButton variant="sidebar" icon="chats" label="Profil" labelCap={1.5} testID="side" />);
    expect(screen.getByText('Profil').props.dataSet).toBeUndefined();
  });
});

describe('label box (M2.8 round 2, DQ-405)', () => {
  it('a middle cell lends its label 12 on each side; an edge cell keeps its label inside the bar', async () => {
    await renderUi(
      <>
        <TabButton variant="bar" icon="chats" label="Nachrichten" testID="middle" />
        <TabButton variant="bar" icon="user" label="Profil" edge testID="last" />
      </>,
    );
    const middle = flat(screen.getByTestId('middle.labelBox').props.style);
    expect(middle.marginHorizontal).toBe(-space[12]);
    const last = flat(screen.getByTestId('last.labelBox').props.style);
    expect(last.marginHorizontal ?? 0).toBe(0);
    expect(last.marginLeft ?? 0).toBeGreaterThanOrEqual(0);
    expect(last.marginRight ?? 0).toBeGreaterThanOrEqual(0);
  });
});
