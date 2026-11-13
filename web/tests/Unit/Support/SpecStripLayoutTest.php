<?php

use App\Support\SpecStripLayout as Layout;
use Tests\Support\TrueTypeAdvances;
use Tests\Support\TypeScriptTable;

/**
 * DQ-801: the Blade strip takes the app's rule. The cases of mobile/tests/ui/specStripLayout.test.ts, value for value, plus the
 * R34 at the strip widths /v/{slug} has at 360, 390, 430, 768, 1280 and 1440 (measured in Chromium and WebKit, carbon, de).
 * SpecStrip 2.0 (ADR-422 d): data label, numeral with unit, provenance.
 */
const R34_ITEMS = [
    ['value' => '500', 'unit' => 'PS', 'label' => 'Leistung', 'provenance' => 'Prüfstand'],
    ['value' => '540', 'unit' => 'Nm', 'label' => 'Drehmoment', 'provenance' => 'Prüfstand'],
    ['value' => '2002', 'unit' => null, 'label' => 'Baujahr', 'provenance' => null],
    ['value' => 'AWD', 'unit' => null, 'label' => 'Antrieb', 'provenance' => null],
];

describe('columns (specStripColumns)', function () {
    it('pads every cell with space.12, so a numeral never touches a hairline', function () {
        expect(Layout::CELL_PADDING_X)->toBe(12)
            // 87.5 per cell at 350: 63.5 of text. 63 fits, 64 does not.
            ->and(Layout::fits(350, [63], 4, 0))->toBeTrue()
            ->and(Layout::fits(350, [64], 4, 0))->toBeFalse();
    });

    it('keeps one row when every value and label fits its cell', function () {
        expect(Layout::columns(350, 4, [56, 56, 56, 60, 20, 20, 40, 45], 1))->toBe(4);
    });

    it('becomes the 2×2 grid when one value does not fit a quarter (2002 at 40 is 74 + 24)', function () {
        expect(Layout::columns(350, 4, [56, 56, 74, 60], 1))->toBe(2);
    });

    it('falls back to one column when not even half the strip holds a value, and never claims more than the items', function () {
        expect(Layout::columns(200, 4, [120], 1))->toBe(1)
            ->and(Layout::columns(1000, 3, [50], 1))->toBe(3)
            ->and(Layout::columns(1000, 1, [50], 1))->toBe(1);
    });

    it('is at most 2×2 above the stacking font scale (09 §4.2), even when four would fit', function () {
        expect(Layout::columns(1000, 4, [50], 1, 2))->toBe(2)
            ->and(Layout::columns(1000, 4, [50], 1, 1.2))->toBe(4);
    });

    it('subtracts the dividers from the cells', function () {
        expect(Layout::cellWidth(353, 4, 1))->toBe(87.5);
    });
});

describe('estimates (what the app decides before it measures)', function () {
    it('counts tabular figures, separators and capitals from the Archivo Condensed advances', function () {
        expect(Layout::estimatedValueWidth('2002', 40))->toEqualWithDelta(4 * 0.472 * 40, 1e-9)
            // A five-glyph value at 40 does not fit a phone's quarter (DQ-801: about 81).
            ->and(Layout::estimatedValueWidth('1.020', 40) + 2 * Layout::CELL_PADDING_X)->toBeGreaterThan(Layout::cellWidth(353, 4, 1))
            ->and(Layout::estimatedValueWidth("1\u{2013}2", 10))->toEqualWithDelta((0.472 + 0.375 + 0.472) * 10, 1e-9)
            ->and(Layout::estimatedValueWidth("3,9\u{00A0}s", 10))->toEqualWithDelta((0.472 + 0.234 + 0.472 + 0.151 + 0.415) * 10, 1e-9)
            // Outside the table: the widest letter (W), never less.
            ->and(Layout::estimatedValueWidth("\u{0160}", 10))->toEqualWithDelta(0.768 * 10, 1e-9)
            // Ruling (3): the font's positive pair kerning is added ("A/" +0.023 em); tabular digits have none.
            ->and(Layout::estimatedValueWidth('A/T', 10))->toEqualWithDelta((0.548 + 0.023 + 0.275 + 0.499) * 10, 1e-9)
            ->and(Layout::estimatedValueWidth('1-1', 10))->toEqualWithDelta((0.472 + 0.272 + 0.472) * 10, 1e-9);
    });

    it('sets the data label in capitals with the tracking of label.caps, and the unit beside the numeral (2.0)', function () {
        // BAUJAHR: B .66 A .728 U .736 J .58 A .728 H .746 R .653, six kerning bounds of .023, seven times 0.44 tracking.
        $caps = (0.66 + 0.728 + 0.736 + 0.58 + 0.728 + 0.746 + 0.653 + 6 * 0.023) * 11 + 7 * 0.44;

        expect(Layout::estimatedLabelWidth('Baujahr', 11))->toEqualWithDelta($caps, 1e-9)
            // "ß" is set as "SS" by text-transform.
            ->and(Layout::estimatedLabelWidth('Maß', 11))->toEqualWithDelta(Layout::estimatedLabelWidth('MASS', 11), 1e-9)
            ->and(Layout::estimatedValueLineWidth('540', 'Nm', 40, 11, 0.44))->toEqualWithDelta(3 * 0.472 * 40 + 4 + (0.76 + 0.901 + 0.023) * 11 + 2 * 0.44, 1e-9)
            ->and(Layout::estimatedValueLineWidth('2002', null, 40, 11, 0.44))->toEqualWithDelta(4 * 0.472 * 40, 1e-9)
            // The provenance is a cell line of its own, the API's "Prüfstand" in caption.
            ->and(Layout::estimatedContentWidths([R34_ITEMS[0]], 1, false))->toHaveCount(3)
            ->and(Layout::estimatedContentWidths([R34_ITEMS[2]], 1, false))->toHaveCount(2);
    });

    it('sets hero.numeral on the page and hero.numeral.s in the desktop card (ADR-431 b), capped at 1.3×', function () {
        expect(Layout::type(1, false)['valueSize'])->toBe(64.0)
            ->and(Layout::type(2, false)['valueSize'])->toBe(64 * 1.3)
            ->and(Layout::type(1, true)['valueSize'])->toBe(48.0)
            ->and(Layout::type(2, false)['labelSize'])->toBe(11 * 2.0)
            ->and(Layout::type(2, false)['provenanceSize'])->toBe(12 * 2.0)
            ->and(Layout::type(2, false)['labelTracking'])->toBe(0.44 * 2);
    });

    it('gives FS-3’s R34 the 2×2 grid on every phone and a one-row strip where a quarter holds 2002 and AWD', function () {
        foreach ([320, 350, 390] as $width) {
            expect(Layout::estimatedColumns(R34_ITEMS, $width, 1, false, 1))->toBe(2);
        }

        expect(Layout::estimatedColumns(R34_ITEMS, 600, 1, false, 1))->toBe(4)
            // DREHMOMENT at 22 (176 with its tracking) needs half of 401.
            ->and(Layout::estimatedColumns(R34_ITEMS, 600, 2, false, 1))->toBe(2)
            ->and(Layout::estimatedColumns(R34_ITEMS, 350, 2, false, 1))->toBe(1);
    });

    it('measures the height row by row with a hairline between rows', function () {
        // Padding, data label 14, gap 4, numeral 64 (hero.numeral on the page); a row with a provenance adds gap 4 and caption 16.
        $row = 2 * 16 + 14 + 4 + 64;

        expect(Layout::height(1, 1, false, 1))->toEqual($row)
            ->and(Layout::height(2, 1, false, 1))->toEqual(2 * $row + 1)
            ->and(Layout::height(2, 1, false, 1, [true, false]))->toEqual(2 * $row + 4 + 16 + 1)
            ->and(Layout::rows(4, 2))->toBe(2)
            ->and(Layout::rows(5, 4))->toBe(2);
    });
});

describe('the R34 on /v/{slug}', function () {
    it('takes the columns of the app at every width and both font scales', function (int $viewport, float $strip, int $scale1, int $scale2) {
        $desktop = $viewport >= Layout::DESKTOP_WIDTH;

        expect(Layout::estimatedColumns(R34_ITEMS, $strip, 1, $desktop))->toBe($scale1)
            ->and(Layout::estimatedColumns(R34_ITEMS, $strip, 2, $desktop))->toBe($scale2);
    })->with([
        // At the QA scale 2 a phone's half cannot hold DREHMOMENT at 22: one column.
        '360' => [360, 320, 2, 1],
        '390' => [390, 350, 2, 1],
        '430' => [430, 382, 2, 1],
        '768' => [768, 720, 4, 2],
        // The desktop page puts the strip into the 438 wide summary column, where a quarter cannot hold 2002 at 48.
        '1280' => [1280, 438, 2, 2],
        '1440' => [1440, 438, 2, 2],
    ]);

    it('turns the rule into the narrowest width of each column count, exact to the pixel', function () {
        // On the page hero.numeral 64 leads: "2002" is ceil(120.83) = 121, + 24 → 145 per column, + 1 per divider. At 48 in the
        // desktop card the value line "540 Nm" leads: ceil(91.42) = 92 → 116.
        expect(Layout::thresholds(R34_ITEMS, 1, false))->toBe([['columns' => 4, 'minWidth' => 587.0], ['columns' => 2, 'minWidth' => 293.0], ['columns' => 1, 'minWidth' => null]])
            ->and(Layout::thresholds(R34_ITEMS, 1, true))->toBe([['columns' => 4, 'minWidth' => 467.0], ['columns' => 2, 'minWidth' => 233.0], ['columns' => 1, 'minWidth' => null]])
            // Scale 2: the data label leads at both widths (DREHMOMENT at 22: ceil(175.5) = 176), the numerals stop at 1.3×.
            ->and(Layout::thresholds(R34_ITEMS, 2, false))->toBe([['columns' => 2, 'minWidth' => 401.0], ['columns' => 1, 'minWidth' => null]])
            ->and(Layout::thresholds(R34_ITEMS, 2, true))->toBe([['columns' => 2, 'minWidth' => 401.0], ['columns' => 1, 'minWidth' => null]]);

        foreach ([[1.0, false], [1.0, true], [2.0, false], [2.0, true]] as [$scale, $desktop]) {
            foreach (Layout::thresholds(R34_ITEMS, $scale, $desktop) as $threshold) {
                if ($threshold['minWidth'] !== null) {
                    expect(Layout::estimatedColumns(R34_ITEMS, $threshold['minWidth'], $scale, $desktop))->toBe($threshold['columns'])
                        ->and(Layout::estimatedColumns(R34_ITEMS, $threshold['minWidth'] - 0.01, $scale, $desktop))->toBeLessThan($threshold['columns']);
                }
            }
        }
    });

    it('counts the breakpoints in em of the strip box: body 15, 16 from 1280, times the font scale', function () {
        expect(Layout::breakpoints(R34_ITEMS))->toBe([
            'count' => 4,
            'regimes' => [
                '1-narrow' => [['columns' => 4, 'belowEm' => 39.1334], ['columns' => 2, 'belowEm' => 19.5334], ['columns' => 1, 'belowEm' => null]],
                '1-desktop' => [['columns' => 4, 'belowEm' => 29.1875], ['columns' => 2, 'belowEm' => 14.5625], ['columns' => 1, 'belowEm' => null]],
                '2-narrow' => [['columns' => 2, 'belowEm' => 13.3667], ['columns' => 1, 'belowEm' => null]],
                '2-desktop' => [['columns' => 2, 'belowEm' => 12.5313], ['columns' => 1, 'belowEm' => null]],
            ],
        ]);
    });
});

describe('css', function () {
    it('starts from one row and narrows by container query, scale 2 under its QA attribute', function () {
        $class = Layout::className(R34_ITEMS);
        $css = Layout::css(R34_ITEMS, $class);

        expect($class)->toMatch('/^sc-strip--[0-9a-f]{8}$/')
            ->and($css)->toStartWith('.'.$class.' .sc-strip{grid-auto-flow:row;grid-template-columns:repeat(4,minmax(0,1fr))}')
            ->and($css)->toContain('@media (max-width: 1279.98px){@container sc-strip (width < 39.1334em){.'.$class.' .sc-strip{grid-auto-flow:row;grid-template-columns:repeat(2,minmax(0,1fr))}')
            ->and($css)->toContain('@container sc-strip (width < 19.5334em){.'.$class.' .sc-strip{grid-auto-flow:row;grid-template-columns:repeat(1,minmax(0,1fr))}')
            ->and($css)->toContain('@media (min-width: 1280px){@container sc-strip (width < 29.1875em)')
            // N-2: Safari 16.0–16.3 read container queries but not media range syntax.
            ->and($css)->not->toMatch('/@media \\(width/')
            ->and($css)->toContain('@container sc-strip (width < 14.5625em)')
            ->and($css)->toContain(':root[data-qa-font-scale="2"] .'.$class.' .sc-strip{grid-auto-flow:row;grid-template-columns:repeat(2,minmax(0,1fr))}')
            ->and($css)->toContain('@container sc-strip (width < 13.3667em){:root[data-qa-font-scale="2"] .'.$class.' .sc-strip{grid-auto-flow:row;grid-template-columns:repeat(1,minmax(0,1fr))}')
            ->and($css)->toContain('@container sc-strip (width < 12.5313em)')
            // Hairlines of the 2×2 grid: none on the left of a row, one above the second row; no empty slot with four items.
            ->and($css)->toContain('.'.$class.' .sc-strip-cell:nth-child(2n+1){border-left-width:0;padding-left:0}')
            ->and($css)->toContain('.'.$class.' .sc-strip-cell:nth-child(n+3){border-top-width:1px}')
            ->and($css)->not->toContain('display:block')
            // Printed unescaped into a style element: only generated characters, never the end of the element.
            ->and($css)->toMatch('/^[a-z0-9 .:@\-\[\]="(),{};<>+]+$/i')
            ->and($css)->not->toContain('</');
    });

    it('draws the empty slot of a short last row in two columns, with its divider', function () {
        $items = [['value' => '500', 'label' => 'PS'], ['value' => '540', 'label' => 'Nm'], ['value' => '2002', 'label' => 'Baujahr']];
        $class = Layout::className($items);

        expect(Layout::css($items, $class))->toContain('.'.$class.' .sc-strip::after{display:block;grid-column:span 1}')
            ->and(Layout::css($items, $class))->toStartWith('.'.$class.' .sc-strip{grid-auto-flow:row;grid-template-columns:repeat(3,minmax(0,1fr))}');
    });

    it('shares one class between strips with the same breakpoints, and only those', function () {
        $same = [['value' => '600', 'unit' => 'PS', 'label' => 'Leistung'], ['value' => '640', 'unit' => 'Nm', 'label' => 'Drehmoment'], ['value' => '2003', 'label' => 'Baujahr'], ['value' => 'AWD', 'label' => 'Antrieb']];
        // 1.020 kg is 93.2 at 48 on the desktop, wider than 540 Nm: its own breakpoints.
        $wider = [...R34_ITEMS];
        $wider[3] = ['value' => '1.020', 'unit' => 'kg', 'label' => 'Gewicht'];
        // A provenance wider than the value line in the desktop card ("Herstellerangabe" in caption) moves the breakpoints too.
        $claimed = [...R34_ITEMS];
        $claimed[0]['provenance'] = 'Herstellerangabe';

        expect(Layout::className(Layout::items($same)))->toBe(Layout::className(R34_ITEMS))
            ->and(Layout::className(Layout::items($wider)))->not->toBe(Layout::className(R34_ITEMS))
            ->and(Layout::className($claimed))->not->toBe(Layout::className(R34_ITEMS));
    });

    it('takes Blade entries as the strip prints them: a missing value is a dash', function () {
        expect(Layout::items([['key' => 'power', 'value' => null, 'unit' => 'PS', 'label' => 'Leistung']]))->toBe([['value' => "\u{2013}", 'unit' => 'PS', 'label' => 'Leistung', 'provenance' => null]]);
    });

    it('names power and torque by their spec and gives them the source of the spec tables, as the app does (2.0)', function () {
        $strip = [
            ['key' => 'power', 'value' => '500', 'unit' => 'PS', 'label' => 'PS'],
            ['key' => 'torque', 'value' => null, 'unit' => 'Nm', 'label' => 'Nm'],
            ['key' => 'model_year', 'value' => '2002', 'unit' => null, 'label' => 'Baujahr'],
        ];
        $groups = [['key' => 'power', 'rows' => [
            ['key' => 'power', 'source_label' => 'Prüfstand'],
            ['key' => 'torque', 'source_label' => 'Prüfstand'],
        ]]];

        expect(Layout::entries($strip, $groups, ['power' => 'Leistung', 'torque' => 'Drehmoment']))->toBe([
            ['key' => 'power', 'value' => '500', 'unit' => 'PS', 'label' => 'Leistung', 'provenance' => 'Prüfstand'],
            // Not entered: a dash, and no provenance for a value that is not there.
            ['key' => 'torque', 'value' => null, 'unit' => 'Nm', 'label' => 'Drehmoment', 'provenance' => null],
            ['key' => 'model_year', 'value' => '2002', 'unit' => null, 'label' => 'Baujahr', 'provenance' => null],
        ]);
    });
});

it('keeps its sizes in step with the generated tokens', function () {
    $css = (string) file_get_contents(dirname(__DIR__, 3).'/resources/css/tokens.generated.css');
    $desktop = substr($css, (int) strpos($css, '@media (min-width: '.Layout::DESKTOP_WIDTH.'px)'));
    $size = fn (string $haystack, string $role): ?string => preg_match('/--sc-type-'.$role.'-size: calc\((\d+)px \* (?:min\(var\(--sc-type-scale, 1\), ([\d.]+)\)|var\(--sc-type-scale, 1\))\)/', $haystack, $match) === 1 ? $match[1].'|'.($match[2] ?? '') : null;

    expect($size($css, 'hero-numeral'))->toBe(Layout::NUMERAL_SIZE.'|'.Layout::NUMERAL_MAX_SCALE)
        ->and($size($desktop, 'hero-numeral-s'))->toBe(Layout::NUMERAL_SIZE_DESKTOP.'|'.Layout::NUMERAL_MAX_SCALE)
        ->and($size($css, 'caption'))->toBe(Layout::CAPTION_SIZE.'|')
        ->and($css)->toContain('--sc-type-caption-line: calc('.Layout::CAPTION_LINE.'px')
        ->and($css)->toContain('--sc-type-caption-tracking: calc('.Layout::CAPTION_TRACKING.'px')
        ->and($size($css, 'label-caps'))->toBe(Layout::CAPS_SIZE.'|')
        ->and($css)->toContain('--sc-type-label-caps-line: calc('.Layout::CAPS_LINE.'px')
        ->and($css)->toContain('--sc-type-label-caps-tracking: calc('.Layout::CAPS_TRACKING.'px')
        ->and($size($css, 'label-unit'))->toBe(Layout::UNIT_SIZE.'|')
        ->and($css)->toContain('--sc-type-label-unit-tracking: calc('.Layout::UNIT_TRACKING.'px')
        ->and($size($css, 'body'))->toBe(Layout::BODY_SIZE.'|')
        ->and($size($desktop, 'body'))->toBe(Layout::BODY_SIZE_DESKTOP.'|');
});

describe('the glyph table (SF-R2-2)', function () {
    $repo = dirname(__DIR__, 4);

    it('holds the real advances of the shipped Archivo Condensed SemiBold, rounded up, tabular figures from its tnum', function () use ($repo) {
        $font = TrueTypeAdvances::fromFile($repo.'/mobile/assets/fonts/ArchivoCondensed-SemiBold.ttf');
        $expected = [...str_split('0123456789'), '.', ',', "\u{2013}", '-', '/', '+', "\u{00D7}", ' ', "\u{00A0}", "\u{202F}", ...range('A', 'Z'), ...range('a', 'z')];

        expect(array_map('strval', array_keys(Layout::GLYPH_EM)))->toBe($expected)
            // The web serves the same file (design/scripts/check-fonts.mjs keeps the copies identical).
            ->and(hash_file('sha256', $repo.'/web/resources/fonts/ArchivoCondensed-SemiBold.ttf'))->toBe(hash_file('sha256', $repo.'/mobile/assets/fonts/ArchivoCondensed-SemiBold.ttf'))
            // U+202F is not in the cmap; the table gives it the space advance.
            ->and($font->hasCharacter("\u{202F}"))->toBeFalse();

        foreach (Layout::GLYPH_EM as $char => $em) {
            $char = (string) $char;
            $real = $font->em($font->hasCharacter($char) ? $char : ' ');

            expect($em)->toBeGreaterThanOrEqual($real, sprintf('U+%04X', mb_ord($char)))
                ->and($em - $real)->toBeLessThan(0.001, sprintf('U+%04X', mb_ord($char)));
        }

        // Tabular figures: one width for every digit, wider than the proportional "1".
        expect(array_unique(array_map(fn (string $digit): int => $font->advance($digit), str_split('0123456789'))))->toBe([472])
            ->and($font->advance('1', false))->toBeLessThan(472);
    });

    it('gives every character outside the table the widest letter', function () {
        $letters = array_filter(Layout::GLYPH_EM, fn (string|int $char): bool => ctype_alpha((string) $char), ARRAY_FILTER_USE_KEY);

        expect(Layout::GLYPH_FALLBACK_EM)->toBe(max($letters))
            ->and(Layout::GLYPH_FALLBACK_EM)->toBe(Layout::GLYPH_EM['W']);
    });

    it('never estimates a value narrower than the font can draw it, positive kerning included (AWD, A/T; Š falls back)', function (string $value) use ($repo) {
        $font = TrueTypeAdvances::fromFile($repo.'/mobile/assets/fonts/ArchivoCondensed-SemiBold.ttf');
        $chars = mb_str_split($value);
        $pairs = $font->positivePairs(array_values(array_unique($chars)), true);
        $kerning = 0;

        for ($i = 1; $i < count($chars); $i++) {
            $kerning += $pairs[$chars[$i - 1].$chars[$i]] ?? 0;
        }

        foreach ([40, 48, 52, 62.4] as $size) {
            expect(Layout::estimatedValueWidth($value, $size))->toBeGreaterThanOrEqual(($font->width($value) + $kerning / $font->unitsPerEm) * $size);
        }
    })->with(['AWD', 'RWD', 'FWD', '4MATIC', '2002', '1.020', "3,9\u{00A0}s", "8,5J \u{00D7} 19", 'A/T', 'K/L/A']);

    it('reads a TypeScript glyph table in any key spelling (the parity test\'s own parser)', function () {
        $source = "const x = { a: 'web' };\nexport const GLYPH_EM: Readonly<Record<string, number>> = {\n  // digits\n  '0': 0.472, 1: 0.472, \"9\": 0.5,\n"
            ."  '\\u00A0': 0.151, '\\u{202F}': 0.151, '\u{2013}': 0.375, W: 0.768, '\\'': 0.2,\n"
            .implode('', array_map(fn (string $c): string => "  {$c}: 0.4,\n", range('a', 'p')))."};\nfunction f() { return { W: 1 }; }";
        $table = TypeScriptTable::glyphTable($source);

        expect($table)->not->toBeNull()
            ->and($table['0'] ?? null)->toBe(0.472)
            ->and($table['1'] ?? null)->toBe(0.472)
            ->and($table['9'] ?? null)->toBe(0.5)
            ->and($table["\u{00A0}"] ?? null)->toBe(0.151)
            ->and($table["\u{202F}"] ?? null)->toBe(0.151)
            ->and($table["\u{2013}"] ?? null)->toBe(0.375)
            ->and($table["'"] ?? null)->toBe(0.2)
            ->and($table['W'] ?? null)->toBe(0.768)
            ->and(TypeScriptTable::glyphTable('const t = { W: 0.768, 0: 0.472, 9: 0.472, ...REST };'))->toBeNull();
    });

    it('holds the font\'s positive pair kerning between its characters, tabular figures as drawn (ruling 3)', function () use ($repo) {
        $font = TrueTypeAdvances::fromFile($repo.'/mobile/assets/fonts/ArchivoCondensed-SemiBold.ttf');
        // The characters both estimates cover (ADR-425 as amended): ( ) & ' are outside GLYPH_EM (they take the fallback) but kern.
        $chars = [...range('A', 'Z'), ...range('a', 'z'), ...str_split('0123456789'), '.', ',', "\u{2013}", '-', '/', '+', "\u{00D7}", '(', ')', '&', "'", ' ', "\u{00A0}", "\u{202F}"];
        $real = array_map(fn (int $units): float => ceil($units / $font->unitsPerEm * 1000 - 1e-9) / 1000, $font->positivePairs($chars, true));
        $php = [];

        foreach (Layout::KERNING as $pair => $em) {
            $php[(string) $pair] = $em;
        }

        ksort($real, SORT_STRING);
        ksort($php, SORT_STRING);

        // The same file on the web (and the same GPOS in its woff2, design/scripts/check-fonts.mjs); digits as .tf glyphs have none.
        expect($php)->toBe($real)
            ->and(array_filter(array_keys($php), fn (string $pair): bool => preg_match('/\d/', $pair) === 1))->toBe([]);
    });

    it('reads a TypeScript pair table in any quoting (the parity test\'s own parser)', function () {
        $good = <<<'TS'
            const G = { W: 1, '0': 1, '9': 1 };
            export const KERN: Readonly<Record<string, number>> = {
              // pairs
              'A/': 0.023, "f'": 0.01, '\u20130': 0.04, '\u{2013}1': 0.04, '–2': 0.04,
            };
            TS;

        expect(TypeScriptTable::pairTable($good))->toBe(['A/' => 0.023, "f'" => 0.01, "\u{2013}0" => 0.04, "\u{2013}1" => 0.04, "\u{2013}2" => 0.04])
            // A literal with a one-character key is a glyph table, not a pair table; two pair tables are ambiguous.
            ->and(TypeScriptTable::pairTable("const K = { 'A/': 0.023, W: 1 };"))->toBeNull()
            ->and(TypeScriptTable::pairTable($good."\n".$good))->toBeNull();
    });

    it('is the pair kerning table of the app, pair by pair (ADR-425 as amended, one source of decision)', function () use ($repo) {
        $app = TypeScriptTable::pairTable((string) file_get_contents($repo.'/mobile/src/ui/specStripLayout.ts'));

        expect($app)->not->toBeNull('mobile/src/ui/specStripLayout.ts has no pair kerning table (two-character keys)');

        $php = [];
        foreach (Layout::KERNING as $pair => $em) {
            $php[(string) $pair] = $em;
        }

        ksort($php, SORT_STRING);
        ksort($app, SORT_STRING);

        expect($app)->toBe($php);
    });

    it('is the table of the app, key by key (ADR-422 a parity)', function () use ($repo) {
        $source = (string) file_get_contents($repo.'/mobile/src/ui/specStripLayout.ts');
        $app = TypeScriptTable::glyphTable($source);

        expect($app)->not->toBeNull('mobile/src/ui/specStripLayout.ts has no glyph table with W and the digits');

        $php = [];
        foreach (Layout::GLYPH_EM as $char => $em) {
            $php[(string) $char] = $em;
        }

        ksort($php, SORT_STRING);
        ksort($app, SORT_STRING);

        expect(array_keys($app))->toBe(array_keys($php));

        foreach ($php as $char => $em) {
            expect($app[$char])->toBe($em, sprintf('U+%04X', mb_ord((string) $char)));
        }
    });
});

describe('the Inter tables of the data label, unit and provenance (SpecStrip 2.0, ADR-422 d)', function () {
    $repo = dirname(__DIR__, 4);
    $tables = [
        'semibold' => ['LABEL_SEMIBOLD_EM', Layout::LABEL_SEMIBOLD_EM, Layout::LABEL_SEMIBOLD_KERN, 'Inter-SemiBold.ttf'],
        'medium' => ['LABEL_MEDIUM_EM', Layout::LABEL_MEDIUM_EM, Layout::LABEL_MEDIUM_KERN, 'Inter-Medium.ttf'],
    ];

    it('holds the real advances of the shipped Inter, rounded up, and a kerning bound no pair exceeds', function (string $face) use ($repo, $tables) {
        [, $table, $kern, $file] = $tables[$face];
        $font = TrueTypeAdvances::fromFile($repo.'/mobile/assets/fonts/'.$file);

        // The web serves the same file.
        expect(hash_file('sha256', $repo.'/web/resources/fonts/'.$file))->toBe(hash_file('sha256', $repo.'/mobile/assets/fonts/'.$file));

        foreach ($table as $char => $em) {
            $char = (string) $char;
            $real = $font->em($char, false);

            expect($em)->toBeGreaterThanOrEqual($real, sprintf('U+%04X', mb_ord($char)))
                ->and($em - $real)->toBeLessThan(0.001, sprintf('U+%04X', mb_ord($char)));
        }

        $pairs = $font->positivePairs(array_map('strval', array_keys($table)), false);

        expect(max([0, ...array_values($pairs)]) / $font->unitsPerEm)->toBeLessThanOrEqual($kern)
            ->and($kern - max([0, ...array_values($pairs)]) / $font->unitsPerEm)->toBeLessThan(0.001);
    })->with(['semibold', 'medium']);

    it('is the table of the app, key by key', function (string $face) use ($repo, $tables) {
        [$name, $table] = $tables[$face];
        $source = (string) file_get_contents($repo.'/mobile/src/ui/specLabelMetrics.ts');
        $app = TypeScriptTable::glyphTable(substr($source, (int) strpos($source, 'export const '.$name)));

        expect($app)->not->toBeNull('mobile/src/ui/specLabelMetrics.ts has no '.$name);

        $php = [];
        foreach ($table as $char => $em) {
            $php[(string) $char] = $em;
        }

        ksort($php, SORT_STRING);
        ksort($app, SORT_STRING);

        expect(array_keys($app))->toBe(array_keys($php));

        foreach ($php as $char => $em) {
            expect($app[$char])->toBe($em, sprintf('U+%04X', mb_ord((string) $char)));
        }
    })->with(['semibold', 'medium']);

    it('takes the kerning bounds of the app', function () use ($repo) {
        $source = (string) file_get_contents($repo.'/mobile/src/ui/specLabelMetrics.ts');

        expect($source)->toContain('export const LABEL_SEMIBOLD_KERN = '.Layout::LABEL_SEMIBOLD_KERN.';')
            ->and($source)->toContain('export const LABEL_MEDIUM_KERN = '.Layout::LABEL_MEDIUM_KERN.';');
    });

    it('gives every character outside a table its widest letter (W)', function () {
        expect(Layout::widestLetter(Layout::LABEL_SEMIBOLD_EM))->toBe(Layout::LABEL_SEMIBOLD_EM['W'])
            ->and(Layout::widestLetter(Layout::LABEL_MEDIUM_EM))->toBe(Layout::LABEL_MEDIUM_EM['W'])
            ->and(Layout::estimatedInterWidth("\u{0160}", 10, 0, true))->toEqualWithDelta(Layout::LABEL_SEMIBOLD_EM['W'] * 10, 1e-9);
    });
});

it('takes its geometry from the tokens, and public.css draws the cell with the same numbers (N-5)', function () {
    $repo = dirname(__DIR__, 4);
    $tokens = json_decode((string) file_get_contents($repo.'/design/tokens/tokens.json'), true, flags: JSON_THROW_ON_ERROR);
    $css = (string) file_get_contents($repo.'/web/resources/css/public.css');
    preg_match('/^\.sc-strip-cell \{([^}]*)\}/m', $css, $cell);

    expect(Layout::CELL_PADDING_X)->toBe($tokens['space']['12'])
        ->and(Layout::CELL_PADDING_Y)->toBe($tokens['space']['16'])
        ->and(Layout::CELL_GAP)->toBe($tokens['space']['4'])
        ->and(Layout::UNIT_GAP)->toBe($tokens['space']['4'])
        ->and(Layout::DIVIDER)->toBe($tokens['size']['border']['control'])
        ->and(Layout::DESKTOP_WIDTH)->toBe($tokens['layout']['breakpoints']['desktop'])
        ->and($cell[1] ?? '')->toContain('padding: '.Layout::CELL_PADDING_Y.'px '.Layout::CELL_PADDING_X.'px;')
        ->and($cell[1] ?? '')->toContain('gap: '.Layout::CELL_GAP.'px;');
});
