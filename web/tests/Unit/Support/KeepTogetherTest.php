<?php

use App\Support\KeepTogether;

it('keeps a hyphenated word of a name on one line and leaves the text as it is', function (string $name, string $html) {
    $result = KeepTogether::name($name)->toHtml();

    expect($result)->toBe($html)
        ->and(html_entity_decode(strip_tags($result), ENT_QUOTES | ENT_HTML5))->toBe($name)
        ->and($result)->not->toContain("\u{2060}");
})->with([
    'GT-R' => ['Skyline GT-R R34', 'Skyline <span class="sc-keep">GT-R</span> R34'],
    'RX-7' => ['Mazda RX-7', 'Mazda <span class="sc-keep">RX-7</span>'],
    'make with a hyphen' => ['Mercedes-Benz 190 E 2.5-16 Evo II', '<span class="sc-keep">Mercedes-Benz</span> 190 E <span class="sc-keep">2.5-16</span> Evo II'],
    'no hyphen' => ['Silvia S15', 'Silvia S15'],
    'a dash between spaces wraps as before' => ['Golf – GTI', 'Golf – GTI'],
    'a hyphen at the edge of a word' => ['Turbo- und Saugmotor', 'Turbo- und Saugmotor'],
    'empty' => ['', ''],
]);

it('escapes what the member typed', function () {
    expect(KeepTogether::name('<b>GT-R</b> & "Co"')->toHtml())
        ->toBe('<span class="sc-keep">&lt;b&gt;GT-R&lt;/b&gt;</span> &amp; &quot;Co&quot;');
});

it('takes null as an empty name', function () {
    expect(KeepTogether::name(null)->toHtml())->toBe('');
});

describe('figures (DQ-229, the Blade twin of keepFiguresTogether)', function () {
    $nbsp = "\u{00A0}";

    it('keeps a figure with its unit, keeps a run of values together, and lets the words around them wrap', function (string $line, string $kept) {
        $html = KeepTogether::figures($line)->toHtml();

        expect($html)->toBe($kept)
            ->and(str_replace("\u{00A0}", ' ', html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5)))->toBe($line);
    })->with([
        'a value after a cut' => ['AP Racing Radi-CAL · 356 mm', "AP Racing Radi-CAL{$nbsp}· 356{$nbsp}mm"],
        'a negative figure' => ["KW V3 · \u{2212}35 mm", "KW V3{$nbsp}· \u{2212}35{$nbsp}mm"],
        'a whole line' => ["Fahrwerk: Serie \u{2192} Tein Flex Z · \u{2212}30 mm", "Fahrwerk: Serie{$nbsp}\u{2192} Tein Flex Z{$nbsp}· \u{2212}30{$nbsp}mm"],
        'both sides of an arrow' => ["Leistung: 130 PS \u{2192} 165 PS", "Leistung: 130{$nbsp}PS{$nbsp}\u{2192} 165{$nbsp}PS"],
        'a run of wheel values' => ['Volk Racing TE37 Saga 18″ × 9,5J ET22', 'Volk Racing TE37 Saga <span class="sc-run">18″ × 9,5J ET22</span>'],
        'a value with a slash' => ['18″ × 9,5J ET22 · 265/35 R18 · 1.500 U/min', '<span class="sc-run">18″ × 9,5J ET22'.$nbsp.'·</span> <span class="sc-run"><span class="sc-keep">265/35</span> R18'.$nbsp.'·</span> 1.500'.$nbsp.'<span class="sc-keep">U/min</span>'],
        'never across a cut, never before it' => ['500 PS · 380 mm', "500{$nbsp}PS{$nbsp}· 380{$nbsp}mm"],
        'a cut at the start' => ['· 380 mm', "· 380{$nbsp}mm"],
        'a figure before a word' => ['3 Fotos hinzugefügt', '3 Fotos hinzugefügt'],
        'a sentence' => ['2 mal getauscht, 4 Mann', '2 mal getauscht, 4 Mann'],
        'a word with a slash' => ['Serie/Sport', 'Serie/Sport'],
        'a unit before punctuation' => ['Tiefer um 35 mm.', "Tiefer um 35{$nbsp}mm."],
        'line breaks stay' => ["Saisonstart:\nÖl und Kerzen neu.", "Saisonstart:\nÖl und Kerzen neu."],
        'empty' => ['', ''],
    ]);

    it('escapes what the member typed', function () use ($nbsp) {
        expect(KeepTogether::figures('356 mm <b>Brembo</b> & "Co"')->toHtml())->toBe("356{$nbsp}mm &lt;b&gt;Brembo&lt;/b&gt; &amp; &quot;Co&quot;");
    });

    it('keeps double spaces as written, except where it joins', function (string $line, string $kept) {
        expect(KeepTogether::figures($line)->toHtml())->toBe($kept);
    })->with([
        'between words' => ['Brembo  GT  Kit', 'Brembo  GT  Kit'],
        'between a word and a figure' => ['Tiefer  um  35 mm', "Tiefer  um  35{$nbsp}mm"],
        'inside a run of values' => ['18″  ×  9,5J  ET22', '<span class="sc-run">18″  ×  9,5J  ET22</span>'],
        'after a cut' => ['KW V3 ·  356 mm', "KW V3{$nbsp}·  356{$nbsp}mm"],
        'a figure and its unit join' => ['356  mm', "356{$nbsp}mm"],
        'before a cut it joins' => ['KW V3  · 356 mm', "KW V3{$nbsp}· 356{$nbsp}mm"],
    ]);

    it('takes null as an empty line', function () {
        expect(KeepTogether::figures(null)->toHtml())->toBe('');
    });
});

describe('a text PCRE cannot read (M1.9)', function () {
    // "\xC3\x28" is not UTF-8: every /u pattern fails on it and preg_* returns null or false instead of a result.
    $broken = "Brembo GT-R \xC3\x28 356 mm";

    it('never blanks a name', function () use ($broken) {
        $html = KeepTogether::name($broken)->toHtml();

        expect($html)->toBe(e($broken))
            ->and($html)->toContain('Brembo GT-R', '356 mm', "\u{FFFD}");
    });

    it('never blanks a line of values', function () use ($broken) {
        $html = KeepTogether::figures($broken)->toHtml();

        expect($html)->toBe(e($broken))
            ->and($html)->toContain('Brembo GT-R', '356 mm', "\u{FFFD}");
    });
});
