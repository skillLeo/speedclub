/**
 * DQ-926, DQ-927: names and identifiers inside running copy on the member web. A vehicle or part name never breaks at its own
 * hyphen ("Nissan Skyline GT- / R R34", "Akrapovič Slip- / On") and keeps its trailing code; an e-mail address shows exactly
 * the characters on file ("lukas.sc@speed- / club.test" read as another address) and a product name never hyphenates
 * ("Google Authentica- / tor"). The copy around them keeps its hyphenation (DQ-181) and pretty wrapping.
 */
import { screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { labelText, targetLabel } from '@/features/safety/labels';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';
import { SlotText, slot } from '@/ui/SlotText';
import { identifierText, nameInText, PRODUCT_NAMES } from '@/ui/textBreaks';

import { flat, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false, isIOS: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('expo-haptics', () => ({}));

const WJ = '⁠';
const NBSP = ' ';
const ZWSP = '​';
const originalOS = Platform.OS;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

type Node = ReturnType<typeof screen.getByTestId>;
/** The nested spans of a Text: each value SlotText set apart. */
const spans = (node: Node) => node.children.filter((child): child is Node => typeof child !== 'string');
const hyphensOf = (node: Node) => (flat(node.props.style) as Record<string, unknown>).hyphens;

describe('nameInText (DQ-926)', () => {
  it('keeps the hyphen of a name and binds its trailing code', () => {
    expect(nameInText('Nissan Skyline GT-R R34')).toBe(`Nissan Skyline GT-${WJ}R${NBSP}R34`);
    expect(nameInText('Akrapovič Slip-On')).toBe(`Akrapovič Slip-${WJ}On`);
    expect(nameInText('Mercedes-Benz C 63 AMG')).toBe(`Mercedes-${WJ}Benz C${NBSP}63${NBSP}AMG`);
    // ADR-426 c: no breakable space would remain before the pair, so it stays breakable.
    expect(nameInText('Porsche 911')).toBe('Porsche 911');
  });

  it('sets published.body with the name in one piece and the copy around it as before', async () => {
    const text = i18n.t('published.body', { ns: 'garage', lng: 'de', vehicle: slot('vehicle') });
    await renderUi(<SlotText variant="body" text={text} slots={{ vehicle: nameInText('Nissan Skyline GT-R R34') }} testID="body" />);
    const body = screen.getByTestId('body');
    expect(body).toHaveTextContent(/^Nissan Skyline GT-.R.R34 hat jetzt einen eigenen QR-.Code\./);
    const [name] = spans(body);
    expect(name?.children.join('')).toContain(`GT-${WJ}R`);
    expect(name && hyphensOf(name)).toBe('none');
    // The copy keeps the running-text rule.
    expect(hyphensOf(body)).toBe('auto');
    expect((flat(body.props.style) as Record<string, unknown>).textWrapStyle).toBe('pretty');
  });
});

describe('identifiers and product names (DQ-927)', () => {
  it('lets an address break only after "@", "." and "/", never at its hyphen', () => {
    expect(identifierText('lukas.sc@speed-club.test')).toBe(`lukas.${ZWSP}sc@${ZWSP}speed-${WJ}club.${ZWSP}test`);
    expect(identifierText('speedclub.de/c/7H2KQXMB')).toBe(`speedclub.${ZWSP}de/${ZWSP}c/${ZWSP}7H2KQXMB`);
    expect(identifierText('nina')).toBe('nina');
  });

  it('sets the e-mail of SET-03 in a span that never hyphenates', async () => {
    const text = i18n.t('email.intro', { ns: 'settings', lng: 'de', email: slot('email') });
    await renderUi(<SlotText variant="body" text={text} slots={{ email: identifierText('lukas.sc@speed-club.test') }} testID="intro" />);
    const intro = screen.getByTestId('intro');
    const [email] = spans(intro);
    expect(email?.children.join('').replace(/[​⁠]/g, '')).toBe('lukas.sc@speed-club.test');
    expect(email && hyphensOf(email)).toBe('none');
  });

  it.each(['de', 'en'])('keeps "Google Authenticator" whole in the SET-05 intro (%s)', async (lng) => {
    const text = i18n.t('twoFactor.intro', { ns: 'settings', lng });
    await renderUi(<SlotText variant="body" text={text} keep={PRODUCT_NAMES} testID="intro" />);
    const kept = spans(screen.getByTestId('intro')).map((span) => ({ text: span.children.join(''), hyphens: hyphensOf(span) }));
    expect(kept).toContainEqual({ text: 'Google Authenticator', hyphens: 'none' });
  });
});

describe('safety labels (DQ-926)', () => {
  it('keeps a vehicle name and a handle together in the decision and report copy', () => {
    const t = i18n.getFixedT('de', 'safety');
    expect(labelText('Nissan Skyline GT-R R34')).toContain(`GT-${WJ}R${NBSP}R34`);
    expect(labelText('@paul.roadster')).toBe(`@paul.${ZWSP}roadster`);
    expect(targetLabel(t, { type: 'photo', label: 'Nissan Skyline GT-R R34' })).toBe(`Foto von Nissan Skyline GT-${WJ}R${NBSP}R34`);
  });
});
