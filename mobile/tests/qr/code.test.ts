import { CROCKFORD_ALPHABET, displayQrCode, displayQrUrl, guestViewUrl, normalizeQrCode } from '@/features/qr/code';

describe('normalizeQrCode (as App\\Support\\Codes::normalize, separators included)', () => {
  it.each([
    ['8TR0Q3MC', '8TR0Q3MC'],
    ['8tr0q3mc', '8TR0Q3MC'],
    ['8TR0 Q3MC', '8TR0Q3MC'],
    ['8tr0-q3mc', '8TR0Q3MC'],
    [' 8TR0  Q3MC ', '8TR0Q3MC'],
    ['8TR0–Q3MC', '8TR0Q3MC'],
    ['8TR0%20Q3MC', '8TR0Q3MC'],
    // Read-alikes: O is 0, I and L are 1.
    ['8TRO Q3MC', '8TR0Q3MC'],
    ['APPY9FZ9', 'APPY9FZ9'],
    ['1LIi0Oo0', '11110000'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeQrCode(input)).toBe(expected);
  });

  it.each([
    ['too short', '8TR0Q3M'],
    ['too long', '8TR0Q3MCX'],
    ['U is not in the alphabet', 'UUUUUUUU'],
    ['other characters', '8TR0Q3M!'],
    ['a slash', '8TR0/Q3MC'],
    ['empty', ''],
    ['a letter that uppercases to two', 'ßTR0Q3M'],
  ])('rejects %s', (_case, input) => {
    expect(normalizeQrCode(input)).toBeNull();
  });

  it('reads the first value of a repeated route param and refuses nothing at all', () => {
    expect(normalizeQrCode(['zzzzzzzz', 'APPY9FZ9'])).toBe('ZZZZZZZZ');
    expect(normalizeQrCode(undefined)).toBeNull();
    expect(normalizeQrCode(null)).toBeNull();
  });

  it('keeps a percent sign that does not decode', () => {
    expect(normalizeQrCode('8TR0%Q3M')).toBeNull();
  });

  it('accepts exactly the 32 Crockford characters', () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    for (const letter of 'ILOU') expect(CROCKFORD_ALPHABET).not.toContain(letter);
    for (const letter of CROCKFORD_ALPHABET) expect(normalizeQrCode(letter.repeat(8))).toBe(letter.repeat(8));
  });
});

describe('display', () => {
  it('prints the code in two groups of four, as FS-9 and the sticker', () => {
    expect(displayQrCode('7H2KQXMB')).toBe('7H2K QXMB');
  });

  it('prints the address without its scheme', () => {
    expect(displayQrUrl('https://speedclub.de/C/7H2KQXMB')).toBe('speedclub.de/C/7H2KQXMB');
    expect(displayQrUrl('http://localhost:8080/C/8TR0Q3MC')).toBe('localhost:8080/C/8TR0Q3MC');
    expect(displayQrUrl('speedclub.de/C/7H2KQXMB')).toBe('speedclub.de/C/7H2KQXMB');
  });
});

describe('guestViewUrl (BH-22)', () => {
  it('asks the server for the page a stranger gets, whoever follows the link', () => {
    expect(guestViewUrl('https://speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj')).toBe('https://speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj?view=public');
  });

  it('keeps a query the address already has', () => {
    expect(guestViewUrl('https://speedclub.de/v/a?utm=x')).toBe('https://speedclub.de/v/a?utm=x&view=public');
  });
});
