<?php

use App\Support\DisplayTitleLayout as Layout;
use App\Support\KeepTogether;
use Tests\Support\TrueTypeAdvances;
use Tests\Support\TypeScriptTable;

/**
 * ADR-426 (a) on the Blade pages: the display.title rule of mobile/src/ui/displayTitleLayout.ts, the same advances and positive
 * pair kerning (ADR-425 as amended), the same line count, the same sizes, the same conditional binding of a trailing code
 * (ADR-426 c as amended). The cases of the app's Jest ("Volkswagen Golf GTI VIII (CD)", "Skyline GT-R R34", the claim) at
 * 360, 375, 393, 412 (the title at the window minus the 20 gutters) and on the web desktop (1280, 1440: WEB-01's summary card,
 * 438 minus the share action, and WEB-03's 560 hero block), at font scale 1 and 2, page and card.
 */
const DT_GOLF = 'Volkswagen Golf GTI VIII (CD)';
const DT_R34 = 'Skyline GT-R R34';
const DT_CLAIM = 'CARS. PEOPLE. CULTURE.';

function displayTitleFontPath(): string
{
    return dirname(__DIR__, 4).'/mobile/assets/fonts/ArchivoSemiExpanded-SemiBold.ttf';
}

describe('the estimate', function () {
    it('measures with the advances, the −1 % tracking and the positive pair kerning', function () {
        // "R34": R 819, 3 669, 4 657 (unitsPerEm 1000), each −0.01 em of tracking.
        expect(Layout::width('R34', 30))->toEqualWithDelta((0.819 + 0.669 + 0.657 - 0.03) * 30, 1e-9)
            // The word joiner draws nothing and takes no tracking; U+00A0 is the space.
            ->and(Layout::width("GT-\u{2060}R", 30))->toEqualWithDelta(Layout::width('GT-R', 30), 1e-9)
            ->and(Layout::width("C\u{00A0}63", 30))->toEqualWithDelta(Layout::width('C 63', 30), 1e-9)
            // A letter with a diacritic takes its base letter's advance; anything else the widest letter (W).
            ->and(Layout::advance("\u{0160}"))->toEqualWithDelta(Layout::advance('S'), 1e-9)
            ->and(Layout::advance("\u{4E00}"))->toEqualWithDelta(1.073 - 0.01, 1e-9)
            ->and(Layout::fallbackEm())->toBe(Layout::ADVANCES['W']);
    });

    it('adds the font\'s positive kerning between adjacent drawn characters, never a negative one (SF-R3-2)', function () {
        // "2.5-16": 5- and -1 each +0.04 em; the word joiner the app puts after a name's hyphen does not end the pair.
        $advances = 0.665 + 0.306 + 0.668 + 0.375 + 0.623 + 0.67 - 6 * 0.01;

        expect(Layout::width('2.5-16', 30))->toEqualWithDelta(($advances + 0.04 + 0.04) * 30, 1e-9)
            ->and(Layout::width("2.5-\u{2060}16", 30))->toEqualWithDelta(Layout::width('2.5-16', 30), 1e-9)
            // "Mazda MX-5": X- has none, -5 has +0.04; "A/" +0.035.
            ->and(Layout::width('MX-5', 30) - Layout::width('MX-', 30) - Layout::width('5', 30))->toEqualWithDelta(0.04 * 30, 1e-9)
            ->and(Layout::width('A/', 10))->toEqualWithDelta((0.809 + 0.302 - 0.02 + 0.035) * 10, 1e-9)
            // Not across a space: the font kerns no pair with a space.
            ->and(Layout::width('5 -', 10))->toEqualWithDelta((0.668 + 0.26 + 0.375 - 0.03) * 10, 1e-9)
            // "To" kerns tighter in the font: left out, so the estimate stays the unkerned sum.
            ->and(Layout::width('To', 10))->toEqualWithDelta((0.717 + 0.672 - 0.02) * 10, 1e-9);
    });

    it('breaks only at plain spaces, greedily: a bound pair is one word, a word wider than the line overflows', function () {
        $golf = KeepTogether::bindTrailingCode(KeepTogether::titleText(DT_GOLF));

        expect(Layout::words(KeepTogether::titleText(DT_GOLF)))->toBe(['Volkswagen', 'Golf', 'GTI', 'VIII', '(CD)'])
            ->and(Layout::words($golf))->toBe(['Volkswagen', 'Golf', 'GTI', "VIII\u{00A0}(CD)"])
            ->and(Layout::lines($golf, 30, 353))->toBe(['lines' => 2, 'overflow' => false])
            ->and(Layout::lines($golf, 30, 461.31))->toBe(['lines' => 1, 'overflow' => false])
            ->and(Layout::lines($golf, 24, 353))->toBe(['lines' => 2, 'overflow' => false])
            ->and(Layout::lines($golf, 24, 372))->toBe(['lines' => 1, 'overflow' => false])
            // "Volkswagen" at 60 is about 378 wide: it would break inside itself, so it never fits a count.
            ->and(Layout::lines($golf, 60, 320)['overflow'])->toBeTrue()
            ->and(Layout::lineCount($golf, 60, 320))->toBe(PHP_INT_MAX)
            ->and(Layout::lines('', 30, 100))->toBe(['lines' => 1, 'overflow' => false]);
    });

    it('finds the narrowest width of each line count, exact to the run of words', function () {
        $r34 = KeepTogether::bindTrailingCode(KeepTogether::titleText(DT_R34));

        foreach ([[30, 1], [30, 2], [24, 1], [24, 2], [44, 2], [60, 2]] as [$size, $lines]) {
            $min = Layout::minWidth($r34, $size, $lines);

            expect(Layout::lineCount($r34, $size, $min))->toBeLessThanOrEqual($lines)
                ->and(Layout::lineCount($r34, $size, $min - 0.01))->toBeGreaterThan($lines);
        }

        // "Skyline" then "GT-R R34" (one word) at 30: 154.2 is the bound pair, 273.6 the whole name.
        expect(round(Layout::minWidth($r34, 30, 1), 2))->toBe(273.6)
            ->and(round(Layout::minWidth($r34, 30, 2), 2))->toBe(154.2);
    });
});

describe('the rule (ADR-426 a)', function () {
    it('takes the size of the app at every width, both font scales, page and card', function (string $title, int $viewport, float $width, array $sizes) {
        $text = KeepTogether::titleText($title);
        $desktop = $viewport >= Layout::DESKTOP_WIDTH;
        $name = $title !== DT_CLAIM;

        expect([
            Layout::size($text, $width, 'page', $desktop, 1, $name),
            Layout::size($text, $width, 'page', $desktop, 2, $name),
            Layout::size($text, $width, 'card', $desktop, 1, $name),
            Layout::size($text, $width, 'card', $desktop, 2, $name),
        ])->toEqual($sizes);
    })->with([
        // [page fs 1, page fs 2, card fs 1, card fs 2]. Two lines at 30 stay 30 on a page and in a card when 24 still takes two.
        'Golf 360' => [DT_GOLF, 360, 320, [30, 48, 30, 48]],
        'Golf 375' => [DT_GOLF, 375, 335, [30, 48, 30, 48]],
        'Golf 393' => [DT_GOLF, 393, 353, [30, 48, 30, 48]],
        // 24 brings it to one line: a card shrinks, a page keeps 30 on two.
        'Golf 412' => [DT_GOLF, 412, 372, [30, 48, 24, 48]],
        'R34 360' => [DT_R34, 360, 320, [30, 60, 30, 60]],
        'R34 375' => [DT_R34, 375, 335, [30, 60, 30, 60]],
        'R34 393' => [DT_R34, 393, 353, [30, 60, 30, 60]],
        'R34 412' => [DT_R34, 412, 372, [30, 60, 30, 60]],
        'claim 360' => [DT_CLAIM, 360, 320, [30, 48, 30, 48]],
        'claim 375' => [DT_CLAIM, 375, 335, [30, 48, 30, 48]],
        'claim 393' => [DT_CLAIM, 393, 353, [30, 48, 24, 48]],
        'claim 412' => [DT_CLAIM, 412, 372, [30, 48, 24, 48]],
        // The web desktop: a page title at 44 while it takes two lines; a card keeps 30 (ADR-426 b).
        'Golf 1280 card' => [DT_GOLF, 1280, 386, [44, 48, 24, 48]],
        'Golf 1440 card' => [DT_GOLF, 1440, 386, [44, 48, 24, 48]],
        'R34 1280 card' => [DT_R34, 1280, 386, [44, 48, 30, 60]],
        'R34 1440 card' => [DT_R34, 1440, 386, [44, 48, 30, 60]],
        'claim 1280 card' => [DT_CLAIM, 1280, 386, [44, 48, 24, 48]],
        'Golf 1440 block' => [DT_GOLF, 1440, 560, [44, 48, 30, 60]],
        'R34 1280 block' => [DT_R34, 1280, 560, [44, 88, 30, 60]],
        'claim 1440 block' => [DT_CLAIM, 1440, 560, [44, 48, 30, 60]],
    ]);

    it('turns the rule into container widths that give exactly its states, size and binding', function (string $title) {
        $text = KeepTogether::titleText($title);
        $bindable = KeepTogether::trailingPair($text) !== null;

        foreach (['page', 'card'] as $placement) {
            foreach ([false, true] as $desktop) {
                foreach ([1.0, 2.0] as $scale) {
                    $rules = Layout::rules($text, $placement, $desktop, $scale, true);
                    $full = Layout::fullSize($placement, $desktop) * $scale;
                    $expected = fn (array $rule): array => ['size' => $rule['shrunk'] ? Layout::MIN_SIZE * $scale : $full, 'shrunk' => $rule['shrunk'], 'bound' => $rule['bound']];

                    expect($rules[0])->toBe(['belowPx' => null, 'shrunk' => false, 'bound' => $bindable ? true : null]);

                    foreach ($rules as $index => $rule) {
                        if ($rule['belowPx'] === null) {
                            continue;
                        }

                        // Just above the threshold the previous step holds, at it and below this one; each step changes something.
                        expect(Layout::state($text, $rule['belowPx'], $placement, $desktop, $scale, true))->toEqual($expected($rules[$index - 1]))
                            ->and(Layout::state($text, $rule['belowPx'] - 0.02, $placement, $desktop, $scale, true))->toEqual($expected($rule))
                            ->and($expected($rule))->not->toEqual($expected($rules[$index - 1]));
                    }

                    // Between the thresholds nothing changes: a sweep in 0.25 px steps meets only the states of the rules.
                    for ($width = 40.0; $width <= 1200; $width += 0.25) {
                        $holding = array_values(array_filter($rules, fn (array $rule): bool => $rule['belowPx'] === null || $width < $rule['belowPx']));

                        expect(Layout::state($text, $width, $placement, $desktop, $scale, true))->toEqual($expected($holding[count($holding) - 1]));
                    }
                }
            }
        }
    })->with([DT_GOLF, DT_R34, DT_CLAIM, 'Mercedes-AMG C 63 S', 'Golf', 'Porsche 911', 'Mercedes-Benz 190 E 2.5-16 Evo II']);

    it('keeps two lines at 30 in a card only where 24 cannot bring it to one', function () {
        $golf = KeepTogether::titleText(DT_GOLF);

        expect(Layout::rules($golf, 'card', false, 1, true))->toBe([
            ['belowPx' => null, 'shrunk' => false, 'bound' => true],
            ['belowPx' => 461.31, 'shrunk' => true, 'bound' => true],
            ['belowPx' => 369.05, 'shrunk' => false, 'bound' => true],
            ['belowPx' => 261.63, 'shrunk' => true, 'bound' => true],
            // "VIII (CD)" at 24 is 102.03 wide: below that the pair is no longer bound.
            ['belowPx' => 102.03, 'shrunk' => true, 'bound' => false],
        ])
            ->and(Layout::rules($golf, 'page', false, 1, true))->toBe([['belowPx' => null, 'shrunk' => false, 'bound' => true], ['belowPx' => 261.63, 'shrunk' => true, 'bound' => true], ['belowPx' => 102.03, 'shrunk' => true, 'bound' => false]])
            ->and(Layout::rules($golf, 'page', true, 1, true))->toBe([['belowPx' => null, 'shrunk' => false, 'bound' => true], ['belowPx' => 383.73, 'shrunk' => true, 'bound' => true], ['belowPx' => 102.03, 'shrunk' => true, 'bound' => false]])
            // Linear in the font scale.
            ->and(Layout::rules($golf, 'page', false, 2, true)[1]['belowPx'])->toBe(523.26)
            // Without binding (not a car name) nothing to bind; here the two lines at 30 break at the same place either way.
            ->and(Layout::rules($golf, 'page', false))->toBe([['belowPx' => null, 'shrunk' => false, 'bound' => null], ['belowPx' => 261.63, 'shrunk' => true, 'bound' => null]]);
    });
});

describe('the trailing code (ADR-426 c as amended)', function () {
    it('never binds "Porsche 911": no breakable space would remain before the pair', function (string $name) {
        $text = KeepTogether::titleText($name);

        expect(KeepTogether::trailingPair($text))->toBeNull()
            ->and(KeepTogether::bindTrailingCode($text))->toBe($text)
            ->and(KeepTogether::title($name)->toHtml())->not->toContain('sc-bind')
            ->and(Layout::css($text, 'sc-title--x', 'page', true))->not->toContain('sc-bind');

        // At the QA scale on a 360 phone (328) it wraps at its space instead of breaking a numeral. Only a word that is wider than
        // the line on its own (Mercedes-Benz at 48 in 320) still overflows, which the app measures; the binding never causes it.
        foreach ([1.0, 2.0] as $scale) {
            foreach ([320.0, 328.0, 353.0] as $width) {
                $state = Layout::state($text, $width, 'page', false, $scale, true);
                $drawn = Layout::shown($text, $state['size'], $width, true);
                $widest = max(array_map(fn (string $word): float => Layout::width($word, $state['size']), Layout::words($text)));

                expect($state['bound'])->toBeNull()
                    ->and($drawn)->toBe($text)
                    ->and(Layout::lines($drawn, $state['size'], $width)['overflow'])->toBe($widest > $width, $name.' at '.$width.' × '.$scale);
            }
        }

        expect(Layout::lines(KeepTogether::titleText('Porsche 911'), 60, 328))->toBe(['lines' => 2, 'overflow' => false]);
    })->with(['Porsche 911', 'Toyota GR86', 'Lamborghini Urus', 'Mercedes-Benz W124', 'BMW M4', 'VW Golf']);

    it('binds "Skyline GT-R R34" only where "GT-R R34" fits the line at the size it is drawn', function () {
        $text = KeepTogether::titleText(DT_R34);
        $pair = "GT-R\u{00A0}R34";

        // 154.2 at 30, 123.36 at 24 (both × 2 at the QA scale).
        expect(KeepTogether::trailingPair($text))->toBe(['Skyline', 'GT-R', 'R34'])
            ->and(round(Layout::width($pair, 30), 2))->toBe(154.2)
            ->and(round(Layout::width($pair, 24), 2))->toBe(123.36)
            ->and(KeepTogether::bindTrailingCode($text, 154.2, 30))->toBe("Skyline {$pair}")
            ->and(KeepTogether::bindTrailingCode($text, 154.1, 30))->toBe($text)
            ->and(KeepTogether::bindTrailingCode($text, 123.36, 24))->toBe("Skyline {$pair}")
            // Wide enough: 30, bound.
            ->and(Layout::state($text, 320, 'page', false, 1, true))->toBe(['size' => 30.0, 'shrunk' => false, 'bound' => true])
            // 140: at 30 the pair does not fit, unbound it takes 3 lines, so 24, where the pair fits and is bound.
            ->and(Layout::state($text, 140, 'page', false, 1, true))->toBe(['size' => 24.0, 'shrunk' => true, 'bound' => true])
            // 120: not even at 24: unbound.
            ->and(Layout::state($text, 120, 'page', false, 1, true))->toBe(['size' => 24.0, 'shrunk' => true, 'bound' => false])
            // The QA scale: bound at 60 from 308.4, at 48 from 246.72.
            ->and(Layout::state($text, 328, 'page', false, 2, true)['bound'])->toBeTrue()
            ->and(Layout::state($text, 300, 'page', false, 2, true))->toBe(['size' => 48.0, 'shrunk' => true, 'bound' => true])
            ->and(Layout::state($text, 246, 'page', false, 2, true))->toBe(['size' => 48.0, 'shrunk' => true, 'bound' => false]);
    });

    it('counts an overflow at the full size that disappears at 24 as a shrink', function () {
        // "Lamborghini" is 191.97 at 30 and 153.58 at 24: wider than a 170 line only at 30.
        $text = KeepTogether::titleText('Lamborghini Urus');

        expect(Layout::lines($text, 30, 170)['overflow'])->toBeTrue()
            ->and(Layout::lines($text, 24, 170)['overflow'])->toBeFalse()
            ->and(Layout::size($text, 170, 'page', false, 1, true))->toEqual(24)
            ->and(Layout::size($text, 170, 'card', false, 1, true))->toEqual(24);
    });
});

describe('css', function () {
    it('sets the full size per range and shrinks by container query on sc-title, scale 2 under its QA attribute', function () {
        $text = KeepTogether::titleText(DT_R34);
        $placements = ['phone' => 'page', 'desktop' => 'card'];
        $class = Layout::className($text, $placements, true);
        $css = Layout::css($text, $class, $placements, true);
        $shrink = 'font-size:var(--sc-type-display-title-shrink-size);line-height:var(--sc-type-display-title-shrink-line);letter-spacing:var(--sc-type-display-title-shrink-tracking)';
        $base = 'font-size:var(--sc-type-display-title-base-size);line-height:var(--sc-type-display-title-base-line);letter-spacing:var(--sc-type-display-title-base-tracking)';
        $scope = '.sc-display-title.'.$class;
        $qa = ':root[data-qa-font-scale="2"] .sc-display-title.'.$class;
        $bound = '{white-space:nowrap}';
        $free = '{white-space:normal}';

        expect($class)->toMatch('/^sc-title--[0-9a-f]{8}$/')
            ->and($class)->not->toBe(Layout::className($text, $placements))
            // Phone and tablet place it alike: one range below 1280, the page rule; the pair bound at every state but the narrowest.
            ->and($css)->toStartWith('@media (max-width: 1279.98px){'.$scope.'{font-size:var(--sc-type-display-title-size);')
            ->and($css)->toContain($scope.' .sc-bind'.$bound.'@container sc-title (width < 154.2px){'.$scope.'{'.$shrink.'}'.$scope.' .sc-bind'.$bound.'}')
            ->and($css)->toContain('@container sc-title (width < 123.36px){'.$scope.'{'.$shrink.'}'.$scope.' .sc-bind'.$free.'}}')
            // From 1280 the card: 30/34, 24 where that makes one line, 30 on two lines, 24 below, unbound below 123.36.
            ->and($css)->toContain('@media (min-width: 1280px){'.$scope.'{'.$base.'}'.$scope.' .sc-bind'.$bound.'@container sc-title (width < 273.6px){'.$scope.'{'.$shrink.'}'.$scope.' .sc-bind'.$bound.'}@container sc-title (width < 218.88px){'.$scope.'{'.$base.'}'.$scope.' .sc-bind'.$bound.'}@container sc-title (width < 154.2px)')
            ->and($css)->toContain('@container sc-title (width < 308.4px){'.$qa.'{'.$shrink.'}'.$qa.' .sc-bind'.$bound.'}')
            ->and($css)->toContain('@container sc-title (width < 246.72px){'.$qa.'{'.$shrink.'}'.$qa.' .sc-bind'.$free.'}')
            ->and($css)->toContain('@container sc-title (width < 547.2px){'.$qa.'{'.$shrink.'}')
            ->and(substr_count($css, '@media '))->toBe(4)
            // N-R3-1: every query names its container.
            ->and(substr_count($css, '@container '))->toBe(substr_count($css, '@container sc-title ('))
            // Safari 16.0–16.3 read container queries but not media range syntax.
            ->and($css)->not->toMatch('/@media \\(width/')
            ->and($css)->toMatch('/^[a-z0-9 .:@\-\[\]="(),{};<>]+$/i')
            ->and($css)->not->toContain('</');
    });

    it('leaves the binding out where there is nothing to bind', function () {
        expect(Layout::css('Cars. People. Culture.', 'sc-title--x', 'page'))->not->toContain('sc-bind')
            ->and(Layout::css(DT_R34, 'sc-title--x', 'page'))->not->toContain('sc-bind')
            ->and(Layout::css(KeepTogether::titleText('Porsche 911'), 'sc-title--x', 'page', true))->not->toContain('sc-bind');
    });

    it('splits phone and tablet when they place the title differently (WEB-03 featured)', function () {
        $text = KeepTogether::titleText(DT_GOLF);
        $placements = ['phone' => 'page', 'tablet' => 'card'];
        $css = Layout::css($text, 'sc-title--x', $placements, true);

        expect(Layout::placements($placements))->toBe(['phone' => 'page', 'tablet' => 'card', 'desktop' => 'card'])
            ->and(Layout::placements('card'))->toBe(['phone' => 'card', 'tablet' => 'card', 'desktop' => 'card'])
            ->and($css)->toContain('@media (max-width: 767.98px){')
            ->and($css)->toContain('@media (min-width: 768px) and (max-width: 1279.98px){.sc-display-title.sc-title--x{font-size:var(--sc-type-display-title-base-size);')
            ->and($css)->toContain('@container sc-title (width < 369.05px)')
            ->and(substr_count($css, '@media '))->toBe(6);
    });

    it('shares a class between titles with the same rules, and only those', function () {
        expect(Layout::className('Golf GTI', 'page'))->toBe(Layout::className('Golf GTI', ['phone' => 'page', 'tablet' => 'page', 'desktop' => 'page']))
            ->and(Layout::className('Golf GTI', 'page'))->not->toBe(Layout::className('Golf GTI', 'card'))
            ->and(Layout::className('Golf GTI', 'page'))->not->toBe(Layout::className('Golf GTR', 'page'))
            // Two words: nothing to bind, so binding or not gives the same rules.
            ->and(Layout::className('Golf GTI', 'page', true))->toBe(Layout::className('Golf GTI', 'page'));
    });

    it('never lets the CSS end its style element', function () {
        expect(Layout::style(DT_R34, 'sc-title--x', 'page', true)->toHtml())->not->toContain('</');
    });
});

describe('the advance table', function () {
    it('holds the real advances of the shipped Archivo SemiExpanded SemiBold, rounded up, proportional figures', function () {
        $repo = dirname(__DIR__, 4);
        $font = TrueTypeAdvances::fromFile(displayTitleFontPath());

        expect(hash_file('sha256', $repo.'/web/resources/fonts/ArchivoSemiExpanded-SemiBold.ttf'))->toBe(hash_file('sha256', displayTitleFontPath()))
            ->and($font->unitsPerEm)->toBe(1000)
            ->and($font->hasCharacter("\u{202F}"))->toBeFalse();

        foreach (Layout::ADVANCES as $char => $em) {
            $char = (string) $char;
            $label = sprintf('U+%04X', mb_ord($char));

            if (in_array($char, ["\u{2060}", "\u{200B}"], true)) {
                expect($em)->toBe(0, $label);

                continue;
            }

            $real = $font->em($font->hasCharacter($char) ? $char : ' ', false);

            expect($em)->toBeGreaterThanOrEqual($real, $label)
                ->and($em - $real)->toBeLessThan(0.001, $label);
        }
    });

    it('gives a Latin letter with a diacritic its base letter, never narrower than the font draws it', function () {
        $font = TrueTypeAdvances::fromFile(displayTitleFontPath());

        for ($code = 0xC0; $code <= 0x24F; $code++) {
            $char = mb_chr($code);
            $base = mb_substr((string) Normalizer::normalize($char, Normalizer::FORM_D), 0, 1);

            if ($font->hasCharacter($char) && $base !== $char && isset(Layout::ADVANCES[$base])) {
                expect(Layout::advance($char) - Layout::TRACKING_EM)->toBeGreaterThanOrEqual($font->em($char, false) - 1e-9, sprintf('U+%04X', $code));
            }
        }
    });

    it('holds the font\'s positive pair kerning between the characters the estimate covers (SF-R3-2)', function () {
        $font = TrueTypeAdvances::fromFile(displayTitleFontPath());
        $chars = [...range('A', 'Z'), ...range('a', 'z'), ...str_split('0123456789'), '.', ',', "\u{2013}", '-', '/', '+', "\u{00D7}", '(', ')', '&', "'", ' ', "\u{00A0}", "\u{202F}"];
        $real = array_map(fn (int $units): float => ceil($units / $font->unitsPerEm * 1000 - 1e-9) / 1000, $font->positivePairs($chars, false));
        $php = [];

        foreach (Layout::KERNING as $pair => $em) {
            $php[(string) $pair] = $em;
        }

        ksort($real, SORT_STRING);
        ksort($php, SORT_STRING);

        expect($php)->toBe($real)
            ->and(count($php))->toBe(44)
            // The pairs of the review: digit–hyphen +40, A/ K/ L/ +35, f) f7 +25 (unitsPerEm 1000).
            ->and($php['5-'] ?? null)->toBe(0.04)
            ->and($php['-1'] ?? null)->toBe(0.04)
            ->and($php['A/'] ?? null)->toBe(0.035)
            ->and($php['f)'] ?? null)->toBe(0.025);
    });

    it('is the pair kerning table of the app, pair by pair (ADR-425 as amended, one source of decision)', function () {
        $app = TypeScriptTable::pairTable((string) file_get_contents(dirname(__DIR__, 4).'/mobile/src/ui/displayTitleLayout.ts'));

        expect($app)->not->toBeNull('mobile/src/ui/displayTitleLayout.ts has no pair kerning table (two-character keys)');

        $php = [];
        foreach (Layout::KERNING as $pair => $em) {
            $php[(string) $pair] = $em;
        }

        ksort($php, SORT_STRING);
        ksort($app, SORT_STRING);

        expect($app)->toBe($php);
    });

    it('is the table of the app, key by key (ADR-426 parity)', function () {
        $source = (string) file_get_contents(dirname(__DIR__, 4).'/mobile/src/ui/displayTitleLayout.ts');
        $app = TypeScriptTable::glyphTable($source);

        expect($app)->not->toBeNull('mobile/src/ui/displayTitleLayout.ts has no advance table with W and the digits');

        $php = [];
        foreach (Layout::ADVANCES as $char => $em) {
            $php[(string) $char] = (float) $em;
        }

        ksort($php, SORT_STRING);
        ksort($app, SORT_STRING);

        expect(array_keys($app))->toBe(array_keys($php));

        foreach ($php as $char => $em) {
            expect($app[$char])->toBe($em, sprintf('U+%04X', mb_ord((string) $char)));
        }
    });

    it('takes the tracking and the sizes of the tokens', function () {
        $tokens = json_decode((string) file_get_contents(dirname(__DIR__, 4).'/design/tokens/tokens.json'), true, flags: JSON_THROW_ON_ERROR);
        $role = $tokens['typography']['display.title'];

        expect($role['size'])->toBe(Layout::SIZE)
            ->and($role['web']['size'])->toBe(Layout::SIZE_DESKTOP)
            ->and($role['minSize'])->toBe(Layout::MIN_SIZE)
            ->and($role['maxLines'])->toBe(Layout::MAX_LINES)
            ->and($role['tracking'])->toBe('-1%')
            ->and($tokens['layout']['breakpoints']['desktop'])->toBe(Layout::DESKTOP_WIDTH)
            ->and($tokens['layout']['breakpoints']['tablet'])->toBe(Layout::TABLET_WIDTH);
    });
});
