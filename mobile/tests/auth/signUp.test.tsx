// AUTH-04 consents (DQ-142): the AGB and the Datenschutzerklärung are links inside their own sentence, the checkbox is
// named by the whole sentence, and only the box and the sentence tick it, never the link.
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { PixelRatio, StyleSheet } from 'react-native';

import { SignUpScreen } from '@/features/auth/screens/SignUpScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, size, space, typography } from '@/theme';

import { renderScreen } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
const mockLinkPress = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  usePreventRemove: jest.fn(),
  // DiscardGuardDialog continues a blocked action through the screen's navigation.
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  // As expo-router does: the child gets the press, which runs the Link's own onPress first and then navigates.
  Link: ({ children, href, onPress }: { children: ReactElement; href: string; onPress?: (event: unknown) => void }) => {
    const { cloneElement: clone } = jest.requireActual<typeof import('react')>('react');
    return clone(children as ReactElement<{ onPress?: (event: unknown) => void }>, {
      onPress: (event: unknown) => {
        onPress?.(event);
        mockLinkPress(href);
      },
    });
  },
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.setState({ status: 'guest', member: null });
});

const press = { stopPropagation: jest.fn() };

describe('AUTH-04 consents', () => {
  it('name each checkbox with its whole sentence', async () => {
    await renderScreen(<SignUpScreen />);
    expect(screen.getByRole('checkbox', { name: 'Ich akzeptiere die AGB.' })).toBe(screen.getByTestId('AUTH-04.termsAccepted'));
    expect(screen.getByRole('checkbox', { name: 'Ich habe die Datenschutzerklärung gelesen.' })).toBe(screen.getByTestId('AUTH-04.privacyAccepted'));
    expect(screen.getByRole('checkbox', { name: 'Ich bin mindestens 16 Jahre alt.' })).toBe(screen.getByTestId('AUTH-04.ageConfirmed'));
  });

  it('put the document name as a link inside its sentence, beside the checkbox and not in it', async () => {
    await renderScreen(<SignUpScreen />);
    const terms = screen.getByTestId('AUTH-04.termsAccepted.read');
    // DQ-148: the full stop stands inside the link's focus box; the link is named by the document alone.
    expect(terms).toHaveTextContent('AGB.');
    expect(terms.props.role).toBe('link');
    expect(screen.getByRole('link', { name: 'AGB' })).toBe(terms);
    expect(screen.getByTestId('AUTH-04.termsAccepted.label')).toHaveTextContent('Ich akzeptiere die AGB.');
    expect(screen.getByTestId('AUTH-04.termsAccepted.label')).toContainElement(terms);
    expect(screen.getByTestId('AUTH-04.termsAccepted')).not.toContainElement(terms);
    expect(screen.getByTestId('AUTH-04.privacyAccepted.read')).toHaveTextContent('Datenschutzerklärung');
    // WCAG 2.5.3: the link's name is its visible text, character for character (axe label-content-name-mismatch).
    expect(screen.getByTestId('AUTH-04.privacyAccepted.read').props['aria-label']).toBe('Datenschutzerklärung');
    expect(screen.getByTestId('AUTH-04.privacyAccepted.label')).toHaveTextContent('Ich habe die Datenschutzerklärung gelesen.');
    expect(screen.queryByText('Lesen')).toBeNull();
  });

  it('tick the box from the box and from the sentence', async () => {
    await renderScreen(<SignUpScreen />);
    const box = () => screen.getByTestId('AUTH-04.termsAccepted');
    await fireEvent.press(box());
    expect(box()).toBeChecked();
    await fireEvent.press(screen.getByTestId('AUTH-04.termsAccepted.label'), press);
    expect(box()).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('AUTH-04.ageConfirmed.label', { includeHiddenElements: true }), press);
    expect(screen.getByTestId('AUTH-04.ageConfirmed')).toBeChecked();
  });

  it('open the document from the link without ticking the box', async () => {
    await renderScreen(<SignUpScreen />);
    await fireEvent.press(screen.getByTestId('AUTH-04.privacyAccepted.read'), press);
    expect(mockLinkPress).toHaveBeenCalledWith('/settings/legal/privacy');
    expect(press.stopPropagation).toHaveBeenCalled();
    expect(screen.getByTestId('AUTH-04.privacyAccepted')).not.toBeChecked();
  });

  it('hide the sentence of a consent without a link, which only repeats the checkbox name', async () => {
    await renderScreen(<SignUpScreen />);
    expect(screen.getByTestId('AUTH-04.marketingConsent.label', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    expect(screen.getByTestId('AUTH-04.termsAccepted.label').props['aria-hidden']).toBeUndefined();
  });

  it('give the box a 44 target centred on the first line, ending before the sentence', async () => {
    await renderScreen(<SignUpScreen />);
    const target = StyleSheet.flatten(screen.getByTestId('AUTH-04.termsAccepted').props.style) as Record<string, number>;
    expect(target.position).toBe('absolute');
    expect(target.left).toBe((size.checkbox - size.touchMin) / 2);
    // The line as tall as the box's first line renders at: the OS font scale on native (PixelRatio in Jest).
    expect(target.top).toBe((typography.body.lineHeight * PixelRatio.getFontScale() - size.touchMin) / 2);
    // The target's right edge (box width plus half the difference) stays left of the sentence, which starts 12 after the box.
    expect(size.checkbox + (size.touchMin - size.checkbox) / 2).toBeLessThan(size.checkbox + space[12]);
  });
});

// DQ-146: the compact header of every auth form (AuthScreen) draws its hairline once the form scrolls under it, as the
// settings pages do.
describe('AUTH-04 header', () => {
  it('is driven by the form scroller', async () => {
    await renderScreen(<SignUpScreen />);
    const scroller = screen.getByTestId('AUTH-04.scroll');
    expect(scroller.props.onScroll).toBeDefined();
    expect(scroller.props.scrollEventThrottle).toBe(16);
    expect(screen.getByTestId('AUTH-04.header.hairline', { includeHiddenElements: true })).toBeTruthy();
  });
});
