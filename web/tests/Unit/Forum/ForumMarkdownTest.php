<?php

use App\Services\Forum\ForumMarkdown;

/**
 * M5.8 (ADR-506, m5.8-contract D5): the forum's Markdown subset. Bold, italic, lists, links (http/https) and breaks; everything else is
 * text, and nothing a member typed becomes markup.
 */
it('renders the subset and escapes everything else', function () {
    $html = app(ForumMarkdown::class)->html("**fett** *kursiv* <img src=x onerror=alert(1)>\n- eins\n- zwei\n\n1. a\n2. b\n\n# kein Titel `kein Code` > kein Zitat");

    expect($html)->toContain('<strong>fett</strong>')->toContain('<em>kursiv</em>')
        ->toContain('&lt;img src=x onerror=alert(1)&gt;')
        ->toContain('<ul><li><p>eins</p></li>')->toContain('<ol><li><p>a</p></li>')
        ->toContain('# kein Titel `kein Code` &gt; kein Zitat')
        ->not->toContain('<img')->not->toContain('<h1')->not->toContain('<code')->not->toContain('<blockquote');
});

it('keeps only http and https links, with rel nofollow ugc', function (string $source, ?string $href) {
    $html = app(ForumMarkdown::class)->html($source);

    if ($href === null) {
        expect($html)->not->toContain('<a ');
    } else {
        expect($html)->toContain('<a href="'.$href.'" rel="nofollow ugc noopener noreferrer" target="_blank">');
    }
})->with([
    'inline https' => ['[Seite](https://example.com/a?b=1&c=2)', 'https://example.com/a?b=1&amp;c=2'],
    'bare address' => ['siehe https://example.com/x', 'https://example.com/x'],
    'javascript' => ['[x](javascript:alert(1))', null],
    'javascript autolink' => ['<javascript:alert(1)>', null],
    'data' => ['[x](data:text/html;base64,PHNjcmlwdD4=)', null],
    'relative' => ['[x](/admin)', null],
    'quote breakout' => ['[x](https://example.com/"onmouseover="alert(1))', 'https://example.com/%22onmouseover=%22alert(1)'],
]);

it('answers a tree for the app and a plain excerpt', function () {
    $markdown = app(ForumMarkdown::class);

    expect($markdown->blocks("Zeile eins\nZeile **zwei**"))->toBe([['type' => 'paragraph', 'children' => [
        ['type' => 'text', 'text' => 'Zeile eins', 'bold' => false, 'italic' => false],
        ['type' => 'break'],
        ['type' => 'text', 'text' => 'Zeile ', 'bold' => false, 'italic' => false],
        ['type' => 'text', 'text' => 'zwei', 'bold' => true, 'italic' => false],
    ]]])->and($markdown->plain("- **A**\n- B", 0))->toBe('A B')
        ->and($markdown->blocks('   '))->toBe([]);
});
