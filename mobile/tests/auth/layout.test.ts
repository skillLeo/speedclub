import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { authHeaderInset, barNeedsStack } from '@/features/auth/components/AuthScreen';
import { layout, space } from '@/theme';
import { identifierText } from '@/ui/textBreaks';
import { plainSentence, splitClosingPunctuation, splitDocLink } from '@/features/auth/screens/SignUpScreen';
import { LOGO_SHADOW_PAD, logoShadowFrame, SCRIM_FADE, scrimGeometry } from '@/features/auth/screens/WelcomeScreen';

// The screens' modules reach the session and the network on import; jest hoists these above the imports.
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

describe('FS-1 scrim (AUTH-02)', () => {
  it('fades over 45 % of the screen and is solid from the top of the block when the content fits', () => {
    const scrim = scrimGeometry(844, 520);
    expect(scrim.top).toBeCloseTo(844 * 0.45);
    expect(scrim.top + scrim.height).toBe(844);
    expect(scrim.top + scrim.solidFrom * scrim.height).toBeCloseTo(520);
  });

  it('starts higher when the block does, keeping the whole fade above it', () => {
    const scrim = scrimGeometry(780, 300);
    expect(scrim.top).toBe(300 - SCRIM_FADE);
    expect(scrim.top + scrim.solidFrom * scrim.height).toBeCloseTo(300);
  });

  // DQ-101: at 200 % on a small phone the content is taller than the screen and scrolls. The scrim lies in the scrolling
  // content, so it has to reach the content's end, and the headline at the top of the block stays on its solid part
  // however far the content is scrolled.
  it('reaches the end of content taller than the screen, solid from the top of the block', () => {
    const screen = 780;
    const blockTop = 640;
    const contentHeight = 1310;
    const scrim = scrimGeometry(screen, blockTop, contentHeight);
    expect(scrim.top + scrim.height).toBe(contentHeight);
    expect(scrim.top + scrim.solidFrom * scrim.height).toBeCloseTo(blockTop);
    expect(scrim.top).toBeLessThanOrEqual(blockTop - SCRIM_FADE);
  });

  it('never ends above the screen, whatever the block reports', () => {
    const scrim = scrimGeometry(780, 400, 500);
    expect(scrim.top + scrim.height).toBe(780);
  });

});

// DQ-109, DQ-139: on an admin photo the logo stands on its own soft shadow (build-logo-shadow.mjs), not on a band or an oval.
describe('FS-1 logo shadow (AUTH-02)', () => {
  const brand = join(__dirname, '..', '..', 'assets', 'brand');
  /** Width and height from a PNG's IHDR chunk. */
  const pngSize = (file: string) => {
    const header = readFileSync(join(brand, file));
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  };

  it('lies centred on the logo, its margin further out on every side', () => {
    // 390 window: logo 280.8 x 84 in a slot as wide as the window.
    const frame = logoShadowFrame(390, 280.8, 84);
    const pad = 280.8 * LOGO_SHADOW_PAD;
    expect(frame.left + frame.width / 2).toBeCloseTo(390 / 2);
    expect(frame.width).toBeCloseTo(280.8 + 2 * pad);
    expect(frame.top).toBeCloseTo(-pad);
    expect(frame.top + frame.height / 2).toBeCloseTo(84 / 2);
  });

  it('matches its file: the logo plus LOGO_SHADOW_PAD of its width on every side, so the shadow sits under the letters', () => {
    const logo = pngSize('logo-wide-white.png');
    const shadow = pngSize('logo-wide-shadow.png');
    const logoWidth = shadow.width / (1 + 2 * LOGO_SHADOW_PAD);
    const pad = logoWidth * LOGO_SHADOW_PAD;
    expect(Math.abs(logoWidth - Math.round(logoWidth))).toBeLessThan(0.01);
    expect(Math.abs(shadow.height - ((logoWidth * logo.height) / logo.width + 2 * pad))).toBeLessThanOrEqual(1);
  });
});

// DQ-142: the AGB and the Datenschutzerklärung are links inside their own consent's sentence, never a line of their own.
describe('consent sentences of AUTH-04', () => {
  const auth = (lang: 'de' | 'en') =>
    JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'i18n', 'locales', lang, 'auth.json'), 'utf8')) as {
      signUp: Record<string, string>;
    };

  it('split around the marked document name', () => {
    expect(splitDocLink('Ich akzeptiere die <doc>AGB</doc>.')).toEqual({ before: 'Ich akzeptiere die ', link: 'AGB', after: '.' });
    expect(splitDocLink('<doc>AGB</doc> gelesen')).toEqual({ before: '', link: 'AGB', after: ' gelesen' });
    expect(splitDocLink('Ich bin mindestens 16 Jahre alt.')).toBeNull();
  });

  // DQ-148: the full stop after "AGB" has no gap a focus ring could sit in, so it joins the link's focus box.
  it('take the punctuation that closes the name into the link, and leave the rest of the sentence', () => {
    expect(splitClosingPunctuation('.')).toEqual({ closing: '.', rest: '' });
    expect(splitClosingPunctuation('), bitte.')).toEqual({ closing: '),', rest: ' bitte.' });
    expect(splitClosingPunctuation(' gelesen.')).toEqual({ closing: '', rest: ' gelesen.' });
    expect(splitClosingPunctuation('')).toEqual({ closing: '', rest: '' });
  });

  it('name the checkbox with the whole sentence, without the marks', () => {
    expect(plainSentence('Ich habe die <doc>Datenschutzerklärung</doc> gelesen.')).toBe('Ich habe die Datenschutzerklärung gelesen.');
    expect(plainSentence('Ich bin mindestens 16 Jahre alt.')).toBe('Ich bin mindestens 16 Jahre alt.');
  });

  it.each(['de', 'en'] as const)('%s: AGB and Datenschutz mark exactly one document name, the other consents none', (lang) => {
    const { signUp } = auth(lang);
    for (const key of ['terms', 'privacy']) {
      const parts = splitDocLink(signUp[key] ?? '');
      expect(parts?.link.length).toBeGreaterThan(0);
      expect(`${parts?.before ?? ''}${parts?.after ?? ''}`).not.toMatch(/<\/?doc>/);
    }
    for (const key of ['age', 'marketing']) expect(signUp[key]).not.toMatch(/<\/?doc>/);
  });
});

describe('header of the auth stack (DQ-115, DQ-146)', () => {
  const FORM = layout.inboxPane + space[64];

  it('pads its controls in to the form column and its gutters, so the bar and the hairline span the window', () => {
    for (const [width, gutter] of [
      [768, 24],
      [1280, 32],
      [1440, 32],
    ] as const) {
      expect(width - 2 * authHeaderInset(width, gutter)).toBe(FORM + 2 * gutter);
    }
  });

  it('never pads in a window narrower than the column', () => {
    expect(authHeaderInset(390, 16)).toBe(0);
    expect(authHeaderInset(0, 16)).toBe(0);
  });
});

describe('sticky bar of the auth stack (DQ-112)', () => {
  // "Erstes Auto hinzufügen" in `label` is about 185 wide, "Überspringen" in `labelS` about 90.
  it('stacks when the primary label would wrap beside the secondary', () => {
    expect(barNeedsStack(328, 185, 90)).toBe(true);
  });

  it('keeps one row when the primary label fits beside the secondary', () => {
    expect(barNeedsStack(358, 185, 90)).toBe(false);
  });

  it('counts the padding tokens alone, which hold the border (DQ-065)', () => {
    // 328 − (90 + 2 × 12) − 8 = 206 for the primary, 166 for its label inside 2 × 20.
    expect(barNeedsStack(328, 166, 90)).toBe(false);
    expect(barNeedsStack(328, 167, 90)).toBe(true);
  });

  it('keeps the row until both labels are measured', () => {
    expect(barNeedsStack(328, 0, 90)).toBe(false);
    expect(barNeedsStack(0, 185, 90)).toBe(false);
  });
});

describe('addresses in running text (DQ-130, DQ-927)', () => {
  it('may break after "@" and after a dot, never inside a part or at its own hyphen', () => {
    expect(identifierText('nina.neu@speedclub.test')).toBe(['nina.', 'neu@', 'speedclub.', 'test'].join(ZERO_WIDTH_SPACE));
    expect(identifierText('lukas.sc@speed-club.test')).toBe(`lukas.${ZERO_WIDTH_SPACE}sc@${ZERO_WIDTH_SPACE}speed-\u2060club.${ZERO_WIDTH_SPACE}test`);
  });

  it('leaves an address without parts as it is', () => {
    expect(identifierText('')).toBe('');
    expect(identifierText('nina')).toBe('nina');
  });
});
