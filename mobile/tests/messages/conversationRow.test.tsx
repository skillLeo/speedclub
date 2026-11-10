// MSG-01 row at large type (DQ-413) and in the split view (DQ-418).
import { screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { ConversationRow } from '@/features/messages/components/ConversationRow';
import { hydrateThemePreference, themes } from '@/theme';

import { renderUi } from '../ui/helpers';
import { summary } from './fixtures';

const mockWindow = { fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockWindow.fontScale }),
}));
jest.mock('@/lib/clock', () => ({ now: () => new Date('2026-11-08T11:00:00+01:00') }));

beforeAll(hydrateThemePreference);

const flat = (style: unknown) => StyleSheet.flatten(style as ViewStyle) ?? {};
const noop = () => undefined;

function renderRow(selected = false) {
  return renderUi(
    <ConversationRow
      conversation={summary({ id: 'c1', muted: true, other: { username: 'mercedes.fahrer', displayName: 'Maximilian Mercedes-Benz-Fahrer', avatar: null } })}
      selected={selected}
      organise
      inset={16}
      onOpen={noop}
      onMore={noop}
      testID="row"
    />,
  );
}

describe('MSG-01 row', () => {
  afterEach(() => {
    mockWindow.fontScale = 1;
  });

  it('keeps the time whole: it never shrinks and is never clamped (DQ-413)', async () => {
    await renderRow();
    const time = screen.getByTestId('row.time', { includeHiddenElements: true });
    expect(flat(time.props.style).flexShrink).toBe(0);
    expect(time.props.numberOfLines).toBeUndefined();
    // Name, glyphs and time share the first line at normal size.
    expect(screen.getByTestId('row.name', { includeHiddenElements: true }).props.numberOfLines).toBe(1);
  });

  it('stacks at 130 % and above: the name on up to two lines, then time and mute glyph (DQ-413)', async () => {
    mockWindow.fontScale = 1.3;
    await renderRow();
    const name = screen.getByTestId('row.name', { includeHiddenElements: true });
    expect(name.props.numberOfLines).toBe(2);
    const second = screen.getByTestId('row.time', { includeHiddenElements: true }).parent;
    expect(second).not.toBeNull();
    expect(second?.children.length).toBe(2);
    expect(screen.getByTestId('row.muted', { includeHiddenElements: true })).toBeTruthy();
  });

  it('a selected row is filled edge to edge, the "…" button included (DQ-418)', async () => {
    await renderRow(true);
    expect(flat(screen.getByTestId('row').props.style).backgroundColor).toBe(themes.carbon.color.state.selected);
  });
});
