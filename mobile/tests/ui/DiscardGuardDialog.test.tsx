import { act, fireEvent, screen } from '@testing-library/react-native';
import type { NavigationAction } from 'expo-router';

import { hydrateThemePreference } from '@/theme';
import { DiscardGuardDialog } from '@/ui/DiscardGuardDialog';

import { renderUi } from './helpers';

type Blocked = (options: { data: { action: NavigationAction }; repeat: () => void }) => void;
const mockPreventRemove = jest.fn<void, [boolean, Blocked]>();
const mockRelease = jest.fn();
const mockDispatch = jest.fn<void, [NavigationAction]>();

jest.mock('expo-router', () => ({
  usePreventRemove: (prevent: boolean, callback: Blocked) => {
    mockPreventRemove(prevent, callback);
    return mockRelease;
  },
  useNavigation: () => mockNavigation,
}));

/** This screen inside the modal group's route, inside the root stack (`navigator:0`). */
type Listener = (event: { data: { action: NavigationAction } }) => void;
const mockListeners = new Map<string, Listener[]>();
const routeIn = (stateKey: string, parent: unknown) => ({
  getParent: () => parent,
  getState: () => ({ key: stateKey }),
  addListener: (type: string, listener: Listener) => {
    const list = mockListeners.get(stateKey) ?? [];
    mockListeners.set(stateKey, [...list, listener]);
    expect(type).toBe('removePrevented');
    return () => mockListeners.set(stateKey, (mockListeners.get(stateKey) ?? []).filter((item) => item !== listener));
  },
});
const modalGroupRoute = routeIn('navigator:0', undefined);
const wizardRoute = routeIn('navigator:0-1', modalGroupRoute);
const mockNavigation = { dispatch: mockDispatch, getParent: () => wizardRoute };
/** What the router reports when an action removes the given ancestor routes (by the navigator they sit in). */
const reportTo = (stateKeys: string[], action: NavigationAction) =>
  stateKeys.forEach((key) => (mockListeners.get(key) ?? []).forEach((listener) => listener({ data: { action } })));
jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Warning: 'warning' },
  notificationAsync: jest.fn(() => Promise.resolve()),
}));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  mockPreventRemove.mockClear();
  mockRelease.mockClear();
  mockDispatch.mockClear();
});

const lastCall = () => mockPreventRemove.mock.calls[mockPreventRemove.mock.calls.length - 1]!;
const labels = { title: 'Änderungen verwerfen?', body: 'Nicht gespeichert.', discardLabel: 'Verwerfen', keepLabel: 'Weiter bearbeiten' };
/** What useCloseModal's fallback sends: a REPLACE aimed at the root stack, from no screen. */
const rootReplace: NavigationAction = { type: 'REPLACE', payload: { name: 'index', params: {} }, target: 'navigator:0' };

describe('DiscardGuardDialog', () => {
  it('does not block a clean form', async () => {
    await renderUi(<DiscardGuardDialog dirty={false} {...labels} testID="g" />);
    expect(lastCall()[0]).toBe(false);
  });

  it('blocks a dirty form without asking yet', async () => {
    await renderUi(<DiscardGuardDialog dirty {...labels} testID="g" />);
    expect(lastCall()[0]).toBe(true);
    expect(screen.queryByTestId('g')).toBeNull();
  });

  it('asks when navigation is blocked, and stays on keep', async () => {
    const repeat = jest.fn();
    await renderUi(<DiscardGuardDialog dirty {...labels} testID="g" />);
    await act(async () => lastCall()[1]({ data: { action: rootReplace }, repeat }));
    expect(screen.getByTestId('g')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('g.keep'));
    expect(repeat).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(lastCall()[0]).toBe(true);
  });

  it('continues the blocked navigation once on discard, as it was blocked, and stops guarding', async () => {
    const repeat = jest.fn();
    const onDiscard = jest.fn();
    await renderUi(<DiscardGuardDialog dirty onDiscard={onDiscard} {...labels} testID="g" />);
    await act(async () => lastCall()[1]({ data: { action: rootReplace }, repeat }));
    await fireEvent.press(screen.getByTestId('g.discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease.mock.invocationCallOrder[0]).toBeLessThan(mockDispatch.mock.invocationCallOrder[0]!);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    // No `source` of this screen: the stack that receives the action must not look for the screen among its routes.
    expect(mockDispatch.mock.calls[0]![0]).toEqual({ ...rootReplace, source: undefined });
    expect(Object.prototype.hasOwnProperty.call(mockDispatch.mock.calls[0]![0], 'source')).toBe(true);
    expect(repeat).not.toHaveBeenCalled();
    expect(lastCall()[0]).toBe(false);
  });

  it('keeps an action the screen sent itself (header back, hardware back) as it was', async () => {
    const own: NavigationAction = { type: 'GO_BACK', source: 'step:0-1-0-0' };
    await renderUi(<DiscardGuardDialog dirty {...labels} testID="g" />);
    await act(async () => lastCall()[1]({ data: { action: own }, repeat: jest.fn() }));
    await fireEvent.press(screen.getByTestId('g.discard'));
    expect(mockDispatch).toHaveBeenCalledWith(own);
  });

  it('addresses an untargeted root goBack to the navigator that removed the screen, the outermost that reported it', async () => {
    const rootBack: NavigationAction = { type: 'GO_BACK' };
    await renderUi(<DiscardGuardDialog dirty {...labels} testID="g" />);
    await act(async () => {
      reportTo(['navigator:0', 'navigator:0-1'], rootBack);
      lastCall()[1]({ data: { action: rootBack }, repeat: jest.fn() });
    });
    await fireEvent.press(screen.getByTestId('g.discard'));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK', source: undefined, target: 'navigator:0' });
  });

  it('leaves an untargeted action untargeted when only its own stack removed the screen (GAR-05, GAR-10)', async () => {
    const ownBack: NavigationAction = { type: 'GO_BACK' };
    const other: NavigationAction = { type: 'GO_BACK' };
    await renderUi(<DiscardGuardDialog dirty {...labels} testID="g" />);
    await act(async () => {
      // A different, earlier action reported by an ancestor does not count for this one.
      reportTo(['navigator:0'], other);
      lastCall()[1]({ data: { action: ownBack }, repeat: jest.fn() });
    });
    await fireEvent.press(screen.getByTestId('g.discard'));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK', source: undefined });
  });
});
