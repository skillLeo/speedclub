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
