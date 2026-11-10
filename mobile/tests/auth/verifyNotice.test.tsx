/**
 * shell.verifyNotice (BH-29, recheck): one pressable row, never a block over the content, and a tap that resumes the page it was
 * on. The routing around it is in sessionHost.test.tsx.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet, useWindowDimensions, type TextStyle, type ViewStyle } from 'react-native';

import { VerifyEmailNotice } from '@/features/auth/VerifyEmailNotice';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference, size, themes } from '@/theme';

import { renderScreen } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockPathname = '/v/skyline';
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 360, height: 780, scale: 1, fontScale: 1 })),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const dimensions = useWindowDimensions as jest.Mock;
const BODY = 'Bestätige deine E-⁠Mail-Adresse, um Autos zu veröffentlichen, anderen zu folgen und zu schreiben.';
const SHORT = 'E-⁠Mail bestätigen';
const flat = (style: unknown) => StyleSheet.flatten(style as ViewStyle) as ViewStyle & TextStyle;
const nameOf = (element: { props: Record<string, unknown> }) => element.props['aria-label'] ?? element.props.accessibilityLabel;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = '/v/skyline';
  dimensions.mockReturnValue({ width: 360, height: 780, scale: 1, fontScale: 1 });
  setMember({ id: '01lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null, nextStep: 'verify_email' });
  useSessionStore.setState({ intent: null });
});

describe('the band (DQ recheck: 100 px at 1x, 338 px at 360 x 2)', () => {
  it('is one row with the action beside it, and the whole row is the button', async () => {
    dimensions.mockReturnValue({ width: 1280, height: 800, scale: 1, fontScale: 1 });
    await renderScreen(<VerifyEmailNotice />);
    const row = screen.getByTestId('shell.verifyNotice.action');
    expect(row.props.role).toBe('button');
    const text = screen.getByTestId('shell.verifyNotice.text');
    // The desktop layout has the room for the sentence (652 of 857 px at 1280).
    expect(text).toHaveTextContent(BODY);
    expect(screen.getByText('Code eingeben')).toBeTruthy();
    expect(nameOf(row)).toBe(`${BODY} Code eingeben`);
  });

  // DQ-250: §4 wraps, never truncates. Below the desktop layout the sentence needs 652 px against a box of 193 to 513.
  it.each([
    [360, 1],
    [390, 1.2],
    [430, 1.3],
    [768, 1.45],
    [360, 1.5],
    [390, 2],
    [1280, 1.3],
    [1440, 2],
  ])('says only what to do at %i px x %d, and never cuts the text', async (width, fontScale) => {
    dimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale });
    await renderScreen(<VerifyEmailNotice />);
    const text = screen.getByTestId('shell.verifyNotice.text');
    expect(text).toHaveTextContent(SHORT);
    // The safety net is a second line, never an ellipsis.
    expect(text.props.numberOfLines).toBe(2);
    // WCAG 2.5.3: the native name starts with the visible text, then keeps the whole sentence and the action.
    const name = nameOf(screen.getByTestId('shell.verifyNotice.action'));
    expect(name).toBe(`${SHORT}. ${BODY} Code eingeben`);
    expect(String(name).startsWith(SHORT)).toBe(true);
  });

  it.each([1, 1.2])('keeps "Code eingeben" beside the text up to the stacking scale (%d)', async (fontScale) => {
    dimensions.mockReturnValue({ width: 360, height: 780, scale: 1, fontScale });
    await renderScreen(<VerifyEmailNotice />);
    expect(screen.getByText('Code eingeben')).toBeTruthy();
  });

  it.each([1.3, 1.45, 2])('drops the visible label above the stacking scale (%d): the caret is the action', async (fontScale) => {
    dimensions.mockReturnValue({ width: 360, height: 780, scale: 1, fontScale });
    await renderScreen(<VerifyEmailNotice />);
    expect(screen.queryByText('Code eingeben')).toBeNull();
    expect(nameOf(screen.getByTestId('shell.verifyNotice.action'))).toBe(`${SHORT}. ${BODY} Code eingeben`);
  });

  it('is a touch target of at least 44 and draws a hairline on top, which Light needs against the canvas', async () => {
    await renderScreen(<VerifyEmailNotice />);
    const band = flat(screen.getByTestId('shell.verifyNotice').props.style);
    expect(band.borderTopWidth).toBe(StyleSheet.hairlineWidth);
    expect(band.borderTopColor).toBe(themes.carbon.color.border.subtle);
    expect(band.backgroundColor).toBe(themes.carbon.color.bg.raised);
    // The row's content view, between the pressable and the text, holds the minimum.
    let node = screen.getByTestId('shell.verifyNotice.text').parent;
    let minHeight = 0;
    while (node && node.props.testID !== 'shell.verifyNotice') {
      minHeight = Math.max(minHeight, Number(flat(node.props.style)?.minHeight ?? 0));
      node = node.parent;
    }
    expect(minHeight).toBeGreaterThanOrEqual(size.touchMin);
  });
});

describe('the page it resumes (BH-29 recheck)', () => {
  it('replaces a path kept earlier with this page: the tap is the latest choice', async () => {
    useSessionStore.setState({ intent: { returnTo: '/discover' } });
    await renderScreen(<VerifyEmailNotice />);
    await fireEvent.press(screen.getByTestId('shell.verifyNotice.action'));
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/v/skyline' });
    expect(mockRouter.push).toHaveBeenCalledWith('/verify-email');
  });

  it('keeps an intent with an action: the member still wants that done', async () => {
    const follow = jest.fn();
    useSessionStore.setState({ intent: { action: follow, returnTo: '/u/nina.neu' } });
    await renderScreen(<VerifyEmailNotice />);
    await fireEvent.press(screen.getByTestId('shell.verifyNotice.action'));
    expect(useSessionStore.getState().intent).toEqual({ action: follow, returnTo: '/u/nina.neu' });
  });

  it('forgets a kept path when opened from Home, which has nothing to come back to', async () => {
    mockPathname = '/';
    useSessionStore.setState({ intent: { returnTo: '/discover' } });
    await renderScreen(<VerifyEmailNotice />);
    await fireEvent.press(screen.getByTestId('shell.verifyNotice.action'));
    expect(useSessionStore.getState().intent).toBeNull();
  });
});
