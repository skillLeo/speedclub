<?php

use App\Support\KeepTogether;

it('keeps a hyphenated word of a name on one line and leaves the text as it is', function (string $name, string $html) {
    $result = KeepTogether::name($name)->toHtml();

    expect($result)->toBe($html)
        ->and(str_replace("\u{00A0}", ' ', html_entity_decode(strip_tags($result), ENT_QUOTES | ENT_HTML5)))->toBe($name)
        ->and($result)->not->toContain("\u{2060}");
})->with([
    'GT-R' => ['Skyline GT-R R34', 'Skyline <span class="sc-keep">GT-R</span> R34'],
    'RX-7' => ['Mazda RX-7', 'Mazda <span class="sc-keep">RX-7</span>'],
    'make with a hyphen' => ['Mercedes-Benz 190 E 2.5-16 Evo II', "<span class=\"sc-keep\">Mercedes-Benz</span> 190 E\u{00A0}<span class=\"sc-keep\">2.5-16</span> Evo II"],
    'a model letter keeps its figure (DQ-310)' => ['Mercedes-AMG C 63 S', "<span class=\"sc-keep\">Mercedes-AMG</span> C\u{00A0}63 S"],
    'no hyphen' => ['Silvia S15', 'Silvia S15'],
    'a dash between spaces wraps as before' => ['Golf – GTI', 'Golf – GTI'],
    'a hyphen at the edge of a word' => ['Turbo- und Saugmotor', 'Turbo- und Saugmotor'],
    'empty' => ['', ''],
]);

describe('title (ADR-426 c as amended, the Blade twin of vehicleTitleText)', function () {
    $nbsp = "\u{00A0}";

    it('puts a bindable trailing pair in its .sc-bind span, joined by its plain space, and keeps the text the name', function (string $name, string $html) {
        $result = KeepTogether::title($name)->toHtml();

        expect($result)->toBe($html)
            ->and(KeepTogether::titleText($name))->toBe(html_entity_decode(strip_tags($result), ENT_QUOTES | ENT_HTML5))
            ->and(str_replace("\u{00A0}", ' ', html_entity_decode(strip_tags($result), ENT_QUOTES | ENT_HTML5)))->toBe(trim($name));
    })->with([
        'R34' => ['Skyline GT-R R34', 'Skyline <span class="sc-bind"><span class="sc-keep">GT-R</span> R34</span>'],
        '(CD)' => ['Volkswagen Golf GTI VIII (CD)', 'Volkswagen Golf GTI <span class="sc-bind">VIII (CD)</span>'],
        'G82' => ['BMW M4 Competition G82', 'BMW M4 <span class="sc-bind">Competition G82</span>'],
        'a hyphenated code' => ['Nissan Skyline GT-R', 'Nissan <span class="sc-bind">Skyline <span class="sc-keep">GT-R</span></span>'],
        'after a model letter' => ['Mercedes-AMG C 63 S', "<span class=\"sc-keep\">Mercedes-AMG</span> <span class=\"sc-bind\">C{$nbsp}63 S</span>"],
        // Round-3 review MF-R3-2: no breakable space would remain before the pair, so these stay breakable.
        'two words: Porsche 911' => ['Porsche 911', 'Porsche 911'],
        'two words: Toyota GR86' => ['Toyota GR86', 'Toyota GR86'],
        'two words: Lamborghini Urus' => ['Lamborghini Urus', 'Lamborghini Urus'],
        'two words: Mercedes-Benz W124' => ['Mercedes-Benz W124', '<span class="sc-keep">Mercedes-Benz</span> W124'],
        'two words: VW Golf' => ['VW Golf', 'VW Golf'],
        'five characters stay free' => ['Ford Focus RS500', 'Ford Focus RS500'],
        'one word' => ['Golf', 'Golf'],
        'trimmed first' => ['  Nissan Silvia S15 ', 'Nissan <span class="sc-bind">Silvia S15</span>'],
        'empty' => ['', ''],
    ]);

    it('binds only where a breakable space remains before the pair, counting visible characters as the app does', function () use ($nbsp) {
        expect(KeepTogether::trailingPair('Nissan Skyline GT-R R34'))->toBe(['Nissan Skyline', 'GT-R', 'R34'])
            ->and(KeepTogether::trailingPair("Skyline GT-\u{2060}R"))->toBeNull()
            ->and(KeepTogether::trailingPair("Nissan Skyline GT-\u{2060}R"))->toBe(['Nissan', 'Skyline', "GT-\u{2060}R"])
            ->and(KeepTogether::trailingPair('Porsche 911'))->toBeNull()
            ->and(KeepTogether::trailingPair(' Golf R34'))->toBeNull()
            ->and(KeepTogether::trailingPair("{$nbsp} Golf R34"))->toBeNull()
            ->and(KeepTogether::trailingPair('Golf GTI '))->toBeNull()
            ->and(KeepTogether::bindTrailingCode('Nissan Skyline GT-R R34'))->toBe("Nissan Skyline GT-R{$nbsp}R34")
            ->and(KeepTogether::bindTrailingCode('Porsche 911'))->toBe('Porsche 911')
            ->and(KeepTogether::TRAILING_CODE_MAX)->toBe(4);
    });

    it('binds only where the pair fits the line at the size it is drawn', function () use ($nbsp) {
        // "GT-R R34" is 154.2 wide at 30.
        expect(KeepTogether::bindTrailingCode('Skyline GT-R R34', 154.2, 30))->toBe("Skyline GT-R{$nbsp}R34")
            ->and(KeepTogether::bindTrailingCode('Skyline GT-R R34', 154.19, 30))->toBe('Skyline GT-R R34')
            ->and(KeepTogether::bindTrailingCode('Skyline GT-R R34', 154.19, 24))->toBe("Skyline GT-R{$nbsp}R34");
    });

    it('escapes what the member typed', function () {
        expect(KeepTogether::title('<i> <b>GT-R</b> & "C"')->toHtml())->toBe('&lt;i&gt; <span class="sc-keep">&lt;b&gt;GT-R&lt;/b&gt;</span> <span class="sc-bind">&amp; &quot;C&quot;</span>');
    });
});

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

describe('inlineName (DQ-926: a name inside running text, as vehicleNameText of the app)', function () {
    $wj = "\u{2060}";
    $nbsp = "\u{00A0}";

    it('joins an in-word hyphen, binds a model letter and a trailing code, and stays plain text', function (string $name, string $text) {
        expect(KeepTogether::inlineName($name))->toBe($text);
    })->with([
        'GT-R R34' => ['Nissan Skyline GT-R R34', "Nissan Skyline GT-{$wj}R{$nbsp}R34"],
        'a part name' => ['Akrapovič Slip-On Line', "Akrapovič Slip-{$wj}On{$nbsp}Line"],
        'a model letter' => ['Mercedes-AMG C 63 S', "Mercedes-{$wj}AMG C{$nbsp}63{$nbsp}S"],
        'two words stay breakable (ADR-426 c, MF-R3-2)' => ['Porsche 911', 'Porsche 911'],
        'a person' => ['Anna-Lena', "Anna-{$wj}Lena"],
        'a hyphen at the edge of a word' => ['Turbo- und Saugmotor', 'Turbo- und Saugmotor'],
        'trimmed' => ['  Golf  ', 'Golf'],
    ]);

    it('joins each hyphen once, also when the name already carries the joiner', function () use ($wj) {
        expect(KeepTogether::inlineName("GT-{$wj}R"))->toBe("GT-{$wj}R")
            ->and(KeepTogether::inlineName(null))->toBe('');
    });
});

describe('words and shortNames (keepNameTogether and keepShortNamesTogether of the app, as markup)', function () {
    it('keeps every hyphenated word of a line whole and changes nothing else', function () {
        expect(KeepTogether::words('Nissan · BNR34 · RB26-DETT · C 63')->toHtml())->toBe('Nissan · BNR34 · <span class="sc-keep">RB26-DETT</span> · C 63')
            ->and(KeepTogether::words('<b>X-1</b>')->toHtml())->toBe('<span class="sc-keep">&lt;b&gt;X-1&lt;/b&gt;</span>')
            ->and(KeepTogether::words(null)->toHtml())->toBe('');
    });

    it('keeps a short hyphenated word of a mod name whole and lets a long compound and an address wrap', function (string $text, string $html) {
        expect(KeepTogether::shortNames($text)->toHtml())->toBe($html);
    })->with([
        'Slip-On' => ['Akrapovič Slip-On Line', 'Akrapovič <span class="sc-keep">Slip-On</span> Line'],
        'Hi-Power' => ['HKS Hi-Power', 'HKS <span class="sc-keep">Hi-Power</span>'],
        'a long compound keeps its hyphen as the place to wrap' => ['Aero-Seitenschweller', 'Aero-Seitenschweller'],
        'an address' => ['a-b@x-y.de', 'a-b@x-y.de'],
        'no hyphen' => ['Bilstein B16', 'Bilstein B16'],
    ]);
});

describe('identifier (DQ-927: an address, handle or URL is shown as it is stored)', function () {
    it('wraps only after "." "_" and an inner "@", never at a hyphen, and keeps the text the identifier', function (string $value, string $html) {
        $result = KeepTogether::identifier($value)->toHtml();

        expect($result)->toBe($html)
            ->and(html_entity_decode(strip_tags($result), ENT_QUOTES | ENT_HTML5))->toBe($value)
            // Nothing invisible in the text: copy and paste gets the address.
            ->and($result)->not->toMatch('/[\x{200B}\x{2060}\x{00AD}]/u');
    })->with([
        'e-mail' => ['lukas.sc@speed-club.test', '<span class="sc-ident">lukas.<wbr>sc@<wbr><span class="sc-keep">speed-club</span>.<wbr>test</span>'],
        'handle' => ['@lukas.sc', '<span class="sc-ident">@lukas.<wbr>sc</span>'],
        'handle with an underscore' => ['@paul_roadster', '<span class="sc-ident">@paul_<wbr>roadster</span>'],
        'URL' => ['https://speedclub.de/v/…', '<span class="sc-ident">https://speedclub.<wbr>de/v/…</span>'],
        'a reference' => ['SC-2026-0042', '<span class="sc-ident"><span class="sc-keep">SC-2026-0042</span></span>'],
        'a trailing dot gives no break' => ['a.', '<span class="sc-ident">a.</span>'],
    ]);

    it('stays one word without break points, as the app\'s OwnerRow sets a handle', function () {
        expect(KeepTogether::identifier('@lukas.sc', false)->toHtml())->toBe('<span class="sc-ident">@lukas.sc</span>')
            ->and(KeepTogether::identifier('a@speed-club.test', false)->toHtml())->toBe('<span class="sc-ident">a@<span class="sc-keep">speed-club</span>.test</span>');
    });

    it('escapes what the member typed and prints nothing for nothing', function () {
        expect(KeepTogether::identifier('<b>@x</b>')->toHtml())->toBe('<span class="sc-ident">&lt;b&gt;@<wbr>x&lt;/b&gt;</span>')
            ->and(KeepTogether::identifier('')->toHtml())->toBe('')
            ->and(KeepTogether::identifier(null)->toHtml())->toBe('');
    });
});

describe('sentence (identifiers inside a translated line)', function () {
    it('escapes the line and prints each identifier through identifier()', function () {
        app()->setLocale('de');

        expect(KeepTogether::sentence('public.member.garage_empty_body', [], ['username' => 'lukas.sc'])->toHtml())
            ->toBe('Sobald @<span class="sc-ident">lukas.<wbr>sc</span> ein Auto veröffentlicht, steht es hier.')
            ->and(KeepTogether::sentence('public.vehicle.closing_title', ['name' => '<i>Lukas</i>'])->toHtml())->toBe('Fragen an &lt;i&gt;Lukas&lt;/i&gt;?')
            ->and(KeepTogether::sentence('public.vehicle.closing_title', [], ['name' => '@a<b'])->toHtml())->toBe('Fragen an <span class="sc-ident">@a&lt;b</span>?');
    });

    it('reads the same in English', function () {
        app()->setLocale('en');

        expect(strip_tags(KeepTogether::sentence('public.member.garage_empty_body', [], ['username' => 'lukas.sc'])->toHtml()))
            ->toBe(__('public.member.garage_empty_body', ['username' => 'lukas.sc']));
    });
});
