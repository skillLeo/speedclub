/**
 * DQ-905 / ADR-426 f: a toast's message is `body` (400) and its action `bodyStrong` (600). The gallery's standard undo toast
 * fits one line at 393 and 412 and at most two at 360 with a 200 % font, measured with the shipped Inter advances against the
 * toast's own paddings.
 */
import { act, screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { TOAST_MESSAGE } from '@/features/gallery/sections/OverlaysSection';
import { breakpointFor, hydrateThemePreference, typography } from '@/theme';
import { dismissToast, toast } from '@/ui/toast';
import { TOAST_ACTION_ROLE, TOAST_MESSAGE_ROLE, ToastHost } from '@/ui/ToastHost';

import { flat, renderUi, textOf, visualOf } from './helpers';
import { interFace, lineCount } from './interMetrics';

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  notificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;
const UNDO = 'Rückgängig';

beforeAll(hydrateThemePreference);
beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await act(async () => {
    dismissToast();
    jest.advanceTimersByTime(1000);
  });
  jest.useRealTimers();
});

async function showUndo(width: number, fontScale: number) {
  dimensions.mockReturnValue({ width, height: 852, scale: 3, fontScale });
  await renderUi(<ToastHost />);
  await act(async () => {
    toast(TOAST_MESSAGE, { undo: jest.fn() });
  });
}

const num = (value: unknown) => (typeof value === 'number' ? value : 0);

/** The width the message wraps in, from the toast's own styles; `stacked` puts the action on its own line below. */
function messageWidth(width: number) {
  const toastStyle = flat(screen.getByTestId('toast').props.style);
  const messageStyle = flat(screen.getByTestId('toast.message').props.style);
  const action = visualOf('toast.action');
  const inner = width - 2 * breakpointFor(width).gutter - num(toastStyle.paddingLeft ?? toastStyle.paddingHorizontal) - num(toastStyle.paddingRight);
  const stacked = toastStyle.flexDirection === 'column';
  return { stacked, messageStyle, actionPadding: 2 * num(action.paddingHorizontal), inner };
}

describe('Toast type roles (ADR-426 f)', () => {
  it('sets the message in body and the action in bodyStrong', async () => {
    await showUndo(393, 1);
    expect(TOAST_MESSAGE_ROLE).toBe('body');
    expect(TOAST_ACTION_ROLE).toBe('bodyStrong');
    const message = textOf(screen.getByTestId('toast.message').props.style);
    const action = textOf(screen.getByTestId('toast.action.label').props.style);
    expect(message.fontFamily).toBe(typography.body.fontFamily);
    expect(message.fontSize).toBe(typography.body.fontSize);
    expect(action.fontFamily).toBe(typography.bodyStrong.fontFamily);
    expect(action.fontFamily).not.toBe(message.fontFamily);
  });
});

describe('Toast fit, measured with Inter', () => {
  const body = interFace(typography.body.fontFamily);
  const strong = interFace(typography.bodyStrong.fontFamily);

  it.each([393, 412])('keeps the standard undo toast on one line at %i', async (width) => {
    await showUndo(width, 1);
    const { stacked, actionPadding, inner } = messageWidth(width);
    expect(stacked).toBe(false);
    const available = inner - (strong.width(UNDO, typography.bodyStrong.fontSize) + actionPadding);
    expect(lineCount(TOAST_MESSAGE, body, typography.body.fontSize, available)).toBe(1);
  });

  it('puts the action below at 360 with a 200 % font and keeps the message to two lines', async () => {
    await showUndo(360, 2);
    const { stacked, messageStyle, inner } = messageWidth(360);
    expect(stacked).toBe(true);
    const available = inner - num(messageStyle.paddingRight);
    expect(lineCount(TOAST_MESSAGE, body, typography.body.fontSize * 2, available)).toBeLessThanOrEqual(2);
    expect(flat(screen.getByTestId('toast.action').props.style).alignSelf).toBe('flex-end');
  });
});
