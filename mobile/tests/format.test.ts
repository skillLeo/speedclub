import {
  formatDate,
  formatDateTime,
  formatMonthYear,
  formatNumber,
  formatRelative,
  formatTime,
  isNumericValue,
  parseNumber,
  keepNameTogether,
  keepFiguresTogether,
  keepShortNamesTogether,
  keepValuesTogether,
  roundInt,
  valueSegments,
} from '@/lib/format';

describe('isNumericValue', () => {
  it.each(['500', '2.568', '−35', '−35 mm', '2,9', '380 mm', '255/35 R19', '255/\u206035 R19', '19″ × 9,5J ET35', '19″ × 9,5J ET35 · 255/35 R19', '1.500 U/min'])(
    'treats "%s" as numeric',
    (value) => {
      expect(isNumericValue(value)).toBe(true);
    },
  );

  it.each(['6-Gang manuell', '6-Kolben', '6-Kolben · 380 mm', 'AWD', 'Endschalldämpfer', 'RB26DETT, 2,6 l R6 Biturbo', 'BBS LM 19″ × 9,5J ET35', 'Serie → KW V3', '1998-2002', ''])(
    'treats "%s" as text',
    (value) => {
      expect(isNumericValue(value)).toBe(false);
    },
  );
});

describe('keepValuesTogether', () => {
  const NBSP = '\u00A0';
  const WJ = '\u2060';

  it('only leaves a break after a separator', () => {
    expect(keepValuesTogether('19″ × 9,5J ET35 · 255/35 R19')).toBe(`19″${NBSP}×${NBSP}9,5J${NBSP}ET35${NBSP}· 255/${WJ}35${NBSP}R19`);
    expect(keepValuesTogether('Serie → KW V3 · −35 mm')).toBe(`Serie${NBSP}→ KW${NBSP}V3${NBSP}· −35${NBSP}mm`);
  });

  it('at a large font: a value may wrap at its own spaces, the separator stays attached', () => {
    expect(keepValuesTogether('BBS LM 19″ · 255/35 R19', false)).toBe(`BBS LM 19″${NBSP}· 255/${WJ}35 R19`);
  });

  it('keeps a username with its separator and leaves a single value alone', () => {
    expect(keepValuesTogether('@lukas.sc · Stuttgart')).toBe(`@lukas.sc${NBSP}· Stuttgart`);
    expect(keepValuesTogether('Endschalldämpfer')).toBe('Endschalldämpfer');
  });
});

describe('keepNameTogether', () => {
  const WJ = '\u2060';

  it('joins a hyphen between letters or figures, so a model name never wraps at it (DQ-047)', () => {
    expect(keepNameTogether('Nissan Skyline GT-R R34')).toBe(`Nissan Skyline GT-${WJ}R R34`);
    expect(keepNameTogether('Mazda RX-7')).toBe(`Mazda RX-${WJ}7`);
    expect(keepNameTogether('Mercedes-Benz C-Klasse')).toBe(`Mercedes-${WJ}Benz C-${WJ}Klasse`);
  });

  it('leaves the spaces, a dash between words and a joined hyphen alone', () => {
    expect(keepNameTogether('BMW M3 E92')).toBe('BMW M3 E92');
    expect(keepNameTogether('1998 - 2002')).toBe('1998 - 2002');
    expect(keepNameTogether(`GT-${WJ}R`)).toBe(`GT-${WJ}R`);
    expect(keepNameTogether('-R')).toBe('-R');
  });
});

describe('keepShortNamesTogether', () => {
  it('leaves an address whole, so a copy carries no invisible character', () => {
    expect(keepShortNamesTogether('Schreib an info@sc-x.de oder geh auf https://sc-x.de')).toBe('Schreib an info@sc-x.de oder geh auf https://sc-x.de');
    expect(keepShortNamesTogether('info@sc-x.de GT-R')).toBe(`info@sc-x.de GT-${WJ}R`);
  });

  const WJ = '\u2060';

  it('joins a hyphen in a word short enough to fit a column at 200 % (DQ-047)', () => {
    expect(keepShortNamesTogether('HKS Hi-Power')).toBe(`HKS Hi-${WJ}Power`);
    expect(keepShortNamesTogether('Nissan Skyline GT-R R34 löschen?')).toBe(`Nissan Skyline GT-${WJ}R R34 löschen?`);
  });

  it('leaves a long compound its hyphen to wrap at', () => {
    expect(keepShortNamesTogether('Nismo Aero-Seitenschweller')).toBe('Nismo Aero-Seitenschweller');
    expect(keepShortNamesTogether('Seibon Carbon-Kofferraumdeckel')).toBe('Seibon Carbon-Kofferraumdeckel');
  });

  it('runs twice without a second joiner', () => {
    expect(keepShortNamesTogether(keepShortNamesTogether('GT-R'))).toBe(`GT-${WJ}R`);
  });
});

describe('valueSegments', () => {
  const NBSP = '\u00A0';

  it('marks only numeric segments, so a hyphen never gets a digit-wide box', () => {
    expect(valueSegments('Serie → 6-Kolben · 3-Zoll-Anlage').filter((s) => s.numeric)).toEqual([]);
    expect(valueSegments('Serie → KW V3 · −35 mm').filter((s) => s.numeric)).toEqual([{ text: `−35${NBSP}mm`, numeric: true }]);
    expect(valueSegments('6-Kolben · 380 mm').map((s) => s.numeric)).toEqual([false, false, true]);
    expect(valueSegments('500 PS')).toEqual([{ text: `500${NBSP}PS`, numeric: true }]);
  });

  it('leaves spaces breakable when a value may wrap', () => {
    expect(valueSegments('2,6 l', false)).toEqual([{ text: '2,6 l', numeric: true }]);
  });

  it('keeps a value with a slash whole and still counts it as numeric', () => {
    const WJ = '\u2060';
    expect(valueSegments('265/35 R18')).toEqual([{ text: `265/${WJ}35${NBSP}R18`, numeric: true }]);
    expect(valueSegments('265/35 R18', false)).toEqual([{ text: `265/${WJ}35 R18`, numeric: true }]);
    expect(valueSegments('1.500 U/min')).toEqual([{ text: `1.500${NBSP}U/${WJ}min`, numeric: true }]);
    expect(valueSegments('Serie/Sport')).toEqual([{ text: 'Serie/Sport', numeric: false }]);
  });
});

describe('keepFiguresTogether', () => {
  const NBSP = '\u00A0';
  const WJ = '\u2060';

  it('keeps a run of figures whole and lets the words around it wrap (DQ-216)', () => {
    expect(keepFiguresTogether('Fahrwerk: Serie → Tein Flex Z · −30 mm')).toBe(`Fahrwerk: Serie${NBSP}→ Tein Flex Z${NBSP}· −30${NBSP}mm`);
    expect(keepFiguresTogether('Leistung: 130 PS → 165 PS')).toBe(`Leistung: 130${NBSP}PS${NBSP}→ 165${NBSP}PS`);
    expect(keepFiguresTogether('Volk Racing TE37 Saga 18″ × 9,5J ET22')).toBe(`Volk Racing TE37 Saga 18″${NBSP}×${NBSP}9,5J${NBSP}ET22`);
  });

  it('at a large font: a figure keeps only its unit, so a run may wrap', () => {
    expect(keepFiguresTogether('Saga 18″ × 9,5J ET22 · −35 mm', false)).toBe(`Saga 18″ × 9,5J ET22${NBSP}· −35${NBSP}mm`);
    expect(keepFiguresTogether('Leistung: 130 PS → 165 PS', false)).toBe(`Leistung: 130${NBSP}PS${NBSP}→ 165${NBSP}PS`);
  });

  // The cases of web/tests/Unit/Support/KeepTogetherTest.php, "figures": a line wraps after a cut, never before it.
  describe.each([true, false])('never before a cut, wholeRuns %s (DQ-231)', (wholeRuns) => {
    it.each([
      ['a value after a cut', 'AP Racing Radi-CAL · 356 mm', `AP Racing Radi-CAL${NBSP}· 356${NBSP}mm`],
      ['a negative figure', 'KW V3 · −35 mm', `KW V3${NBSP}· −35${NBSP}mm`],
      ['a whole line', 'Fahrwerk: Serie → Tein Flex Z · −30 mm', `Fahrwerk: Serie${NBSP}→ Tein Flex Z${NBSP}· −30${NBSP}mm`],
      ['both sides of an arrow', 'Leistung: 130 PS → 165 PS', `Leistung: 130${NBSP}PS${NBSP}→ 165${NBSP}PS`],
      ['never across a cut, never before it', '500 PS · 380 mm', `500${NBSP}PS${NBSP}· 380${NBSP}mm`],
      ['a cut at the start', '· 380 mm', `· 380${NBSP}mm`],
    ])('%s', (_name, line, kept) => {
      expect(keepFiguresTogether(line, wholeRuns)).toBe(kept);
    });
  });

  it('keeps a value with a slash whole, not a word with one, as the mod row on Blade does', () => {
    expect(keepFiguresTogether('18″ × 9,5J ET22 · 265/35 R18 · 1.500 U/min')).toBe(`18″${NBSP}×${NBSP}9,5J${NBSP}ET22${NBSP}· 265/${WJ}35${NBSP}R18${NBSP}· 1.500${NBSP}U/${WJ}min`);
    expect(keepFiguresTogether('265/35 R18, 245/40 R18', false)).toBe(`265/${WJ}35 R18, 245/${WJ}40 R18`);
    expect(keepFiguresTogether('Serie/Sport')).toBe('Serie/Sport');
    expect(keepFiguresTogether('Bj. 2002 / 2003')).toBe(`Bj. 2002${NBSP}/${NBSP}2003`);
  });

  it('leaves a sentence alone, its line breaks and a figure before a word included', () => {
    expect(keepFiguresTogether('3 Fotos hinzugefügt')).toBe('3 Fotos hinzugefügt');
    expect(keepFiguresTogether('2 mal getauscht, 4 Mann')).toBe('2 mal getauscht, 4 Mann');
    expect(keepFiguresTogether('Saisonstart:\nÖl und Kerzen neu.')).toBe('Saisonstart:\nÖl und Kerzen neu.');
    expect(keepFiguresTogether('Tiefer um 35 mm.')).toBe(`Tiefer um 35${NBSP}mm.`);
    expect(keepFiguresTogether('')).toBe('');
  });

  it('survives the cut into segments, so the numeric ones keep tabular figures', () => {
    expect(valueSegments(keepFiguresTogether('Serie → KW V3 · −35 mm'), false).filter((s) => s.numeric)).toEqual([{ text: `−35${NBSP}mm`, numeric: true }]);
    expect(valueSegments(keepFiguresTogether('Serie → 265/35 R18'), false).filter((s) => s.numeric)).toEqual([{ text: `265/${WJ}35${NBSP}R18`, numeric: true }]);
  });
});

describe('formatNumber', () => {
  it('formats per locale', () => {
    expect(formatNumber(1500, 'de')).toBe('1.500');
    expect(formatNumber(1500, 'en')).toBe('1,500');
    expect(formatNumber(2.9, 'de')).toBe('2,9');
    expect(formatNumber(2.9, 'en')).toBe('2.9');
  });

  it('uses a real minus sign', () => {
    expect(formatNumber(-35, 'de')).toBe('−35');
    expect(formatNumber(-1500, 'en')).toBe('−1,500');
  });

  it('never prints a negative zero', () => {
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-0.4, 'de', { maxFractionDigits: 0 })).toBe('0');
    expect(formatNumber(-0.04, 'en', { minFractionDigits: 1, maxFractionDigits: 1 })).toBe('0.0');
  });

  it('honours fraction digits', () => {
    expect(formatNumber(3, 'de', { minFractionDigits: 1 })).toBe('3,0');
    expect(formatNumber(2.55, 'de', { maxFractionDigits: 0 })).toBe('3');
  });

  it('does not throw when the minimum is above the maximum', () => {
    expect(formatNumber(1.5, 'de', { minFractionDigits: 5 })).toBe('1,50000');
    expect(formatNumber(1.5, 'en', { minFractionDigits: 2, maxFractionDigits: 1 })).toBe('1.50');
  });

  it('shows a dash for values that are not numbers', () => {
    expect(formatNumber(Number.NaN)).toBe('–');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('–');
  });
});

describe('roundInt', () => {
  it('rounds symmetrically and normalises zero', () => {
    expect(roundInt(2.5)).toBe(3);
    expect(roundInt(-2.5)).toBe(-3);
    expect(roundInt(2.4)).toBe(2);
    expect(Object.is(roundInt(-0.2), 0)).toBe(true);
  });
});

describe('dates in Europe/Berlin', () => {
  it('formats month and year', () => {
    expect(formatMonthYear(new Date('2023-03-15T12:00:00Z'), 'de')).toBe('März 2023');
    expect(formatMonthYear(new Date('2023-03-15T12:00:00Z'), 'en')).toBe('March 2023');
  });

  it('formats a date', () => {
    expect(formatDate(new Date('2026-06-14T12:00:00Z'), 'de')).toBe('14.06.2026');
    expect(formatDate(new Date('2026-06-14T12:00:00Z'), 'en')).toBe('14/06/2026');
  });

  it('crosses midnight in Berlin, not in UTC', () => {
    expect(formatDate(new Date('2026-06-14T22:30:00Z'), 'de')).toBe('15.06.2026');
    expect(formatMonthYear(new Date('2023-02-28T23:30:00Z'), 'de')).toBe('März 2023');
  });

  it('formats summer and winter time', () => {
    expect(formatTime(new Date('2026-06-14T12:30:00Z'), 'de')).toBe('14:30');
    expect(formatTime(new Date('2026-01-14T12:30:00Z'), 'de')).toBe('13:30');
    expect(formatTime(new Date('2026-01-13T23:05:00Z'), 'de')).toBe('00:05');
    expect(formatDateTime(new Date('2026-06-14T12:30:00Z'), 'de')).toBe('14.06.2026, 14:30');
  });
});

describe('formatRelative', () => {
  const reference = new Date('2026-06-14T12:00:00Z'); // 14:00 in Berlin
  const ago = (ms: number) => new Date(reference.getTime() - ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('says just now under a minute', () => {
    expect(formatRelative(ago(59_000), 'de', reference)).toBe('gerade eben');
    expect(formatRelative(ago(59_000), 'en', reference)).toBe('just now');
    expect(formatRelative(ago(-30_000), 'de', reference)).toBe('gerade eben');
  });

  it('counts minutes', () => {
    expect(formatRelative(ago(MIN), 'de', reference)).toBe('vor 1 Min.');
    expect(formatRelative(ago(59 * MIN), 'de', reference)).toBe('vor 59 Min.');
    expect(formatRelative(ago(3 * MIN), 'en', reference)).toBe('3 min ago');
  });

  it('counts hours on the same Berlin day', () => {
    expect(formatRelative(ago(3 * HOUR), 'de', reference)).toBe('vor 3 Std.');
    expect(formatRelative(ago(3 * HOUR), 'en', reference)).toBe('3 hr ago');
    expect(formatRelative(ago(14 * HOUR), 'de', reference)).toBe('vor 14 Std.');
  });

  it('says yesterday from the previous Berlin day', () => {
    expect(formatRelative(ago(15 * HOUR), 'de', reference)).toBe('gestern');
    expect(formatRelative(ago(DAY), 'en', reference)).toBe('yesterday');
    // 00:30 in Berlin, the message was sent at 22:00 the evening before.
    const lateNight = new Date('2026-06-13T22:30:00Z');
    expect(formatRelative(new Date('2026-06-13T20:00:00Z'), 'de', lateNight)).toBe('gestern');
  });

  it('counts days up to six, then shows the date', () => {
    expect(formatRelative(ago(3 * DAY), 'de', reference)).toBe('vor 3 Tagen');
    expect(formatRelative(ago(3 * DAY), 'en', reference)).toBe('3 days ago');
    expect(formatRelative(ago(6 * DAY), 'de', reference)).toBe('vor 6 Tagen');
    expect(formatRelative(ago(7 * DAY), 'de', reference)).toBe('07.06.2026');
  });

  it('shows the date for the future', () => {
    expect(formatRelative(new Date('2026-06-20T12:00:00Z'), 'de', reference)).toBe('20.06.2026');
  });

  it('counts calendar days across the DST change', () => {
    // Clocks went forward on 29 March 2026 in Berlin.
    const after = new Date('2026-03-29T10:00:00Z');
    expect(formatRelative(new Date('2026-03-28T10:00:00Z'), 'de', after)).toBe('gestern');
  });
});

describe('parseNumber', () => {
  it.each([
    ['1.500', 'de', 1500],
    ['1500', 'de', 1500],
    ['2,5', 'de', 2.5],
    ['1,500', 'en', 1500],
    ['1500', 'en', 1500],
    ['1.5', 'en', 1.5],
    ['−35', 'de', -35],
    [' 1 500 ', 'de', 1500],
  ] as const)('reads %s in %s as %d', (text, locale, value) => {
    expect(parseNumber(text, locale)).toBe(value);
  });

  it.each(['', '  ', 'abc', '12x'])('does not read %j as a number', (text) => {
    expect(parseNumber(text, 'de')).toBeNaN();
  });

  // BH-01: a group separator counts only with exactly three digits behind it, anything else is refused, never guessed.
  it.each(['110.5', '9.5', '2.0', '1.2.3', '1234.50', '.5', '1.50', '1.5000', '1.500.00'])('refuses %j in German', (text) => {
    expect(parseNumber(text, 'de')).toBeNaN();
  });

  it.each(['110,5', '9,5', '2,0', '1,2,3', '1234,50', ',5', '1,50', '1,5000', '1,500,00'])('refuses %j in English', (text) => {
    expect(parseNumber(text, 'en')).toBeNaN();
  });

  // A grouped number never starts with a 0 group: "0.500" can only be a decimal typed with the wrong mark, never 500.
  it.each([
    ['0.500', 'de'],
    ['-0.250', 'de'],
    ['00.500', 'de'],
    ['0.500,5', 'de'],
    ['0,500', 'en'],
    ['-0,250', 'en'],
    ['00,500', 'en'],
    ['0,500.5', 'en'],
  ] as const)('refuses %j with a leading zero group in %s', (text, locale) => {
    expect(parseNumber(text, locale)).toBeNaN();
  });

  it.each([
    ['1.998', 'de', 1998],
    ['1.500.000', 'de', 1500000],
    ['1.500,55', 'de', 1500.55],
    ['−1.500,5', 'de', -1500.5],
    ['110,5', 'de', 110.5],
    ['1234,50', 'de', 1234.5],
    ['1,998', 'en', 1998],
    ['1,500,000', 'en', 1500000],
    ['1,500.55', 'en', 1500.55],
    ['110.5', 'en', 110.5],
    ['0,5', 'de', 0.5],
    ['10.500', 'de', 10500],
    ['0.5', 'en', 0.5],
    ['10,500', 'en', 10500],
  ] as const)('still reads %s in %s as %d', (text, locale, value) => {
    expect(parseNumber(text, locale)).toBe(value);
  });
});
