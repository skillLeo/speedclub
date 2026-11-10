/**
 * DiscardGuardDialog in the real router (expo-router/testing-library). The guarded form sits in a stack inside a modal
 * group, like GAR-03 (`(modals)/add-vehicle/[draftId]/<step>`), and is left every way the app leaves it: the wizard's
 * close (useCloseModal, which acts on the root, not on the form's own stack), a goBack on the app's root stack, a back in
 * its own stack (GAR-05, GAR-10) and a back from the router (hardware back, browser history). Verwerfen must finish
 * exactly the navigation that was blocked; Abbrechen must keep the form and the guard.
 */
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, Stack, useNavigation } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/i18n';
import { useCloseModal } from '@/features/garage/navigation';
import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { DiscardGuardDialog } from '@/ui/DiscardGuardDialog';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Warning: 'warning' },
  notificationAsync: jest.fn(() => Promise.resolve()),
}));

configure({ asyncUtilTimeout: 30_000 });
jest.setTimeout(120_000);

beforeAll(hydrateThemePreference);

const onDiscard = jest.fn();
beforeEach(() => onDiscard.mockClear());

const labels = { title: 'Änderungen verwerfen?', body: 'Nicht gespeichert.', discardLabel: 'Verwerfen', keepLabel: 'Abbrechen' };

type NavigationNode = { getParent: () => NavigationNode | undefined; canGoBack: () => boolean; goBack: () => void };

function StackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

function Home() {
  return <View testID="home" />;
}

function Below() {
  return <View testID="below" />;
}

/** A form that starts clean; "change" makes it dirty. */
function Form() {
  const [dirty, setDirty] = useState(false);
  const close = useCloseModal('/');
  const navigation = useNavigation<NavigationNode>();
  // The outermost navigator that can go back: the app's root stack, which presents the modal group as one route.
  const rootBack = () => {
    let target: NavigationNode | undefined;
    for (let node: NavigationNode | undefined = navigation; node; node = node.getParent()) if (node.canGoBack()) target = node;
    target?.goBack();
  };
  return (
    <View testID="form">
      <Pressable testID="form.change" role="button" aria-label="change" onPress={() => setDirty(true)} />
      <Pressable testID="form.close" role="button" aria-label="close" onPress={close} />
      <Pressable testID="form.rootBack" role="button" aria-label="root back" onPress={rootBack} />
      <Pressable testID="form.back" role="button" aria-label="back" onPress={() => navigation.goBack()} />
      <DiscardGuardDialog dirty={dirty} onDiscard={onDiscard} {...labels} testID="guard" />
    </View>
  );
}

const tree = () => ({
  _layout: { default: StackLayout },
  index: { default: Home },
  '(modals)/_layout': { default: StackLayout },
  '(modals)/wizard/_layout': { default: StackLayout },
  '(modals)/wizard/below': { default: Below },
  '(modals)/wizard/step': { default: Form },
});

const Providers = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>
    <ThemeProvider>{children}</ThemeProvider>
  </GestureHandlerRootView>
);

/** Home, then the modal group with the form on top (optionally above another screen of its own stack). */
async function openForm({ below = false, change = true } = {}) {
  const tester = await renderRouter(tree() as never, { initialUrl: '/', wrapper: Providers });
  await screen.findByTestId('home');
  if (below) {
    await act(async () => router.push('/wizard/below'));
    await screen.findByTestId('below');
  }
  await act(async () => router.push('/wizard/step'));
  await screen.findByTestId('form');
  if (change) await fireEvent.press(screen.getByTestId('form.change'));
  return tester;
}

async function choose(action: 'keep' | 'discard') {
  await screen.findByTestId('guard');
  await fireEvent.press(screen.getByTestId(`guard.${action}`));
  // The dialog lets go after its exit motion.
  await waitFor(() => expect(screen.queryByTestId('guard')).toBeNull());
}

describe('DiscardGuardDialog in the router', () => {
  it('the wizard close (useCloseModal) asks, and Verwerfen leaves the modal group', async () => {
    const tester = await openForm();
    await fireEvent.press(screen.getByTestId('form.close'));
    await choose('discard');
    await screen.findByTestId('home');
    expect(screen.queryByTestId('form')).toBeNull();
    expect(tester.getPathname()).toBe('/');
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('a goBack on the root stack while the form is in a modal stack asks, and Verwerfen removes the group', async () => {
    const tester = await openForm({ below: true });
    await fireEvent.press(screen.getByTestId('form.rootBack'));
    await choose('discard');
    await screen.findByTestId('home');
    expect(screen.queryByTestId('form')).toBeNull();
    expect(screen.queryByTestId('below')).toBeNull();
    expect(tester.getPathname()).toBe('/');
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('Abbrechen keeps the form and the guard: the next close asks again', async () => {
    const tester = await openForm();
    await fireEvent.press(screen.getByTestId('form.close'));
    await choose('keep');
    expect(screen.getByTestId('form')).toBeTruthy();
    expect(tester.getPathname()).toBe('/wizard/step');
    expect(onDiscard).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('form.rootBack'));
    await choose('keep');
    expect(tester.getPathname()).toBe('/wizard/step');

    await fireEvent.press(screen.getByTestId('form.close'));
    await choose('discard');
    await screen.findByTestId('home');
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('a back in its own stack (GAR-05, GAR-10) asks, and Verwerfen returns to the screen below', async () => {
    const tester = await openForm({ below: true });
    await fireEvent.press(screen.getByTestId('form.back'));
    await choose('discard');
    await screen.findByTestId('below');
    expect(screen.queryByTestId('form')).toBeNull();
    expect(tester.getPathname()).toBe('/wizard/below');
  });

  it('a back from the router (hardware back, browser history) asks, and Verwerfen goes back one screen', async () => {
    const tester = await openForm({ below: true });
    await act(async () => router.back());
    await choose('discard');
    await screen.findByTestId('below');
    expect(tester.getPathname()).toBe('/wizard/below');
  });

  it('a clean form leaves without asking', async () => {
    const tester = await openForm({ change: false });
    await fireEvent.press(screen.getByTestId('form.close'));
    await screen.findByTestId('home');
    expect(screen.queryByTestId('guard')).toBeNull();
    expect(tester.getPathname()).toBe('/');
  });
});
