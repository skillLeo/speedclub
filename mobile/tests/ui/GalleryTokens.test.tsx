/**
 * DQ-907 / DQ-909: the DEV-01 gallery reads its numbers from the tokens, marks the deprecated colour roles with their
 * replacement, shows the pressed tone of a selected chip and the spacing scale.
 */
import { screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEPRECATED_COLOURS } from '@/features/gallery/data';
import { BadgesSection } from '@/features/gallery/sections/BadgesSection';
import { ChatSection } from '@/features/gallery/sections/ChatSection';
import { ColourSection } from '@/features/gallery/sections/ColourSection';
import { FoundationSection } from '@/features/gallery/sections/FoundationSection';
import { HeaderSection } from '@/features/gallery/sections/HeaderSection';
import { InputsSection } from '@/features/gallery/sections/InputsSection';
import { QrSection } from '@/features/gallery/sections/QrSection';
import { SelectionSection } from '@/features/gallery/sections/SelectionSection';
import { TypographySection } from '@/features/gallery/sections/TypographySection';
import { bubble, hydrateThemePreference, layout, radius, size, space, themes } from '@/theme';

import { flat, renderUi, toneLayerOf } from './helpers';

jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-glass-effect', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { GlassView: View, isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => false };
});

type Deprecated = Record<string, { replacement: string }>;
const tokens = JSON.parse(readFileSync(join(__dirname, '../../../design/tokens/tokens.json'), 'utf8')) as {
  meta: { deprecated: { color: Deprecated } };
};

beforeAll(hydrateThemePreference);

describe('Gallery: deprecated colour roles (DQ-909)', () => {
  it('lists exactly the roles meta.deprecated.color names, with their replacement', () => {
    const fromTokens = Object.fromEntries(Object.entries(tokens.meta.deprecated.color).map(([role, entry]) => [role, entry.replacement]));
    expect(DEPRECATED_COLOURS).toEqual(fromTokens);
  });

  it('captions each one "veraltet → Ersatz" in the colour list', async () => {
    await renderUi(<ColourSection />);
    for (const [role, replacement] of Object.entries(DEPRECATED_COLOURS)) {
      const [group, name] = role.split('.') as [keyof typeof themes.carbon.color, string];
      expect(themes.carbon.color[group]).toHaveProperty(name);
      expect(screen.getByTestId(`DEV-01.colour.deprecated.${role}`)).toHaveTextContent(`veraltet → ${replacement}`);
    }
  });
});

describe('Gallery: specimens (DQ-909)', () => {
  it('shows a selected chip held down, with the inverse pressed tone', async () => {
    await renderUi(<SelectionSection />);
    const tone = toneLayerOf('DEV-01.selection.chipSelectedPressed');
    expect(flat(tone.props.style).backgroundColor).toBe(themes.carbon.color.state.pressedInverse);
    expect(tone).toHaveAnimatedStyle({ opacity: 1 });
  });

  it('draws the spacing scale from the tokens, one bar per step', async () => {
    await renderUi(<FoundationSection />);
    const steps = Object.entries(space).filter(([, value]) => value > 0);
    expect(steps.length).toBeGreaterThan(0);
    for (const [token, value] of steps) {
      const row = screen.getByTestId(`DEV-01.foundation.space.${token}`);
      const bar = row.children.find((child) => typeof child !== 'string');
      expect(bar && typeof bar !== 'string' ? flat(bar.props.style).width : null).toBe(value);
    }
  });
});

describe('Gallery notes from the tokens (DQ-907)', () => {
  it.each([
    ['Suche', () => <InputsSection />, `${size.search} hoch, Radius ${radius.md}`],
    ['QR', () => <QrSection />, `Radius ${radius.md}`],
    ['Blasen', () => <ChatSection />, `Radius ${bubble.radius}, ${bubble.tailRadius} an der Ecke zum Absender`],
    ['Kopfleiste', () => <HeaderSection />, `ab ${layout.phoneLargeMinWidth}\u00a0pt Breite`],
    ['Statusanzeige', () => <BadgesSection />, `${size.statusPill} hoch, Radius ${radius.xs}`],
    ['label.caps', () => <TypographySection />, 'Nur Datenbeschriftungen (LEISTUNG, BAUJAHR)'],
  ])('%s says what the tokens say', async (_name, section, text) => {
    await renderUi(section());
    expect(screen.getByText(text, { exact: false })).toBeTruthy();
  });

  it('no longer carries the v1 values', async () => {
    await renderUi(<InputsSection />);
    expect(screen.queryByText('Radius 10', { exact: false })).toBeNull();
    await renderUi(<HeaderSection />);
    expect(screen.queryByText('ab 390', { exact: false })).toBeNull();
    await renderUi(<BadgesSection />);
    expect(screen.queryByText('Status-Pill')).toBeNull();
  });
});
