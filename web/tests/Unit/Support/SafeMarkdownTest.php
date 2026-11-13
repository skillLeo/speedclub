<?php

use App\Support\SafeMarkdown;
use Illuminate\Support\HtmlString;

/**
 * M1.9: `(string) preg_replace_callback(...)` turned a PCRE failure into '' and blanked a whole paragraph of a legal text.
 * "\xC3\x28" is not UTF-8, so every /u pattern fails on it.
 */
it('keeps the text between tags when a word cannot be read', function () {
    $html = "<p>Deine E-Mail \xC3\x28 und der QR-Code</p>";

    expect(SafeMarkdown::joinShortPrefixes($html))->toBe($html);
});

it('still joins short prefixes in the readable parts of the same document', function () {
    $html = "<p>Deine E-Mail</p><p>kaputt \xC3\x28 QR-Code</p>";

    expect(SafeMarkdown::joinShortPrefixes($html))
        ->toBe("<p>Deine E-\u{2060}Mail</p><p>kaputt \xC3\x28 QR-Code</p>");
});

it('keeps the body when the heading anchors cannot be set', function () {
    // Without JIT, so the backtrack limit applies.
    ini_set('pcre.jit', '0');
    ini_set('pcre.backtrack_limit', '1');

    try {
        $html = '<h2>Kontakt</h2><p>'.str_repeat('Text ', 200).'</p><h2>Rechte</h2>';
        $result = SafeMarkdown::withHeadingAnchors(new HtmlString($html));
    } finally {
        ini_restore('pcre.backtrack_limit');
        ini_restore('pcre.jit');
    }

    expect($result['html']->toHtml())->toBe($html);
});

describe('a paragraph sign and its number (DQ-221)', function () {
    it('joins them with a no-break space in what the renderer prints', function (string $markdown, string $joined) {
        expect(SafeMarkdown::render($markdown)->toHtml())->toContain($joined);
    })->with([
        'one sign' => ['Nummer nach § 27a UStG', "nach \u{00A7}\u{00A0}27a UStG"],
        'in brackets' => ['eine Straftat (§ 315d StGB).', "(\u{00A7}\u{00A0}315d StGB)."],
        'two signs' => ['nach §§ 19 und 21 DSA', "nach \u{00A7}\u{00A7}\u{00A0}19 und 21 DSA"],
        'bold' => ['**§ 5 DDG**', "<strong>\u{00A7}\u{00A0}5 DDG</strong>"],
        'across a soft break' => ["nach §\n27a UStG", "nach \u{00A7}\u{00A0}27a UStG"],
    ]);

    it('leaves everything else as it is', function (string $html) {
        expect(SafeMarkdown::joinParagraphSigns($html))->toBe($html);
    })->with([
        'a sign before a word' => ['<p>der § selbst</p>'],
        'no sign' => ['<p>Art. 17 DSA</p>'],
        'code' => ['<p><code>§ 5</code></p>'],
        'an attribute' => ['<a title="§ 5">Link</a>'],
    ]);

    it('keeps the text it cannot read', function () {
        $html = "<p>nach § 5 \xC3\x28</p>";

        expect(SafeMarkdown::joinParagraphSigns($html))->toBe($html);
    });

    it('does not change the anchor of a heading', function () {
        $result = SafeMarkdown::withHeadingAnchors(SafeMarkdown::render('## Hinweis nach § 36 VSBG'));

        expect($result['toc'][0]['id'])->toBe('s1-hinweis-nach-36-vsbg')
            ->and($result['toc'][0]['title'])->toBe("Hinweis nach \u{00A7}\u{00A0}36 VSBG");
    });
});

describe('a short part of a compound (r5 name-hyphen-break, joinShortCompounds of mobile/src/lib/format.ts)', function () {
    $joiner = "\u{2060}";

    it('joins a hyphen with a part of fewer than 3 letters or figures on either side', function (string $text, string $joined) {
        expect(SafeMarkdown::joinShortCompounds($text))->toBe($joined);
    })->with([
        'a short prefix' => ['Bei einem RB-Spezialisten in Mönchengladbach.', "Bei einem RB-{$joiner}Spezialisten in Mönchengladbach."],
        'two short parts' => ['mit GT-SS-Ladern', "mit GT-{$joiner}SS-{$joiner}Ladern"],
        'a short part after a long one' => ['die Datenschutz-E-Mail', "die Datenschutz-{$joiner}E-{$joiner}Mail"],
        'figures and short suffixes' => ['6-stelligen Code, Plug-in, sign-in', "6-{$joiner}stelligen Code, Plug-{$joiner}in, sign-{$joiner}in"],
        'IP-Adressen' => ['deine IP-Adressen', "deine IP-{$joiner}Adressen"],
    ]);

    it('keeps a hyphen between two longer parts, an existing joiner and an address as they are', function (string $text) {
        expect(SafeMarkdown::joinShortCompounds($text))->toBe($text);
    })->with([
        'two longer parts' => ['Nismo Aero-Seitenschweller'],
        'already joined' => ["E-{$joiner}Mail-Adresse"],
        'addresses' => ['info@sc-x.de und https://sc-x.de/e-mail'],
        'a dash between words' => ['Ölwechsel – erledigt'],
        'no hyphen' => ['Aus Japan importiert.'],
    ]);

    it('keeps the text it cannot read', function () {
        $text = "Deine E-Mail \xC3\x28";

        expect(SafeMarkdown::joinShortCompounds($text))->toBe($text);
    });

    it('applies the same step to rendered documents, after the short prefix, never to a tag, a link target or code', function () use ($joiner) {
        $html = SafeMarkdown::render('Schreib an [[DSA-Kontakt-E-Mail]] oder die Export-E-Mail, nicht an `E-Mail` oder [GT-SS](https://sc-x.de/gt-ss). Aero-Seitenschweller bleiben.')->toHtml();

        expect($html)->toBe("<p>Schreib an [[DSA-{$joiner}Kontakt-{$joiner}E-{$joiner}Mail]] oder die Export-{$joiner}E-{$joiner}Mail, nicht an <code>E-Mail</code> oder <a href=\"https://sc-x.de/gt-ss\">GT-{$joiner}SS</a>. Aero-Seitenschweller bleiben.</p>\n");
    });
});
