<?php

namespace App\Support;

use Illuminate\Support\HtmlString;
use Illuminate\Support\Str;

/**
 * CommonMark in safe mode (05_ARCHITECTURE §15): raw HTML in the source is escaped and javascript:, vbscript:, file: and data: links are
 * dropped. The result is an HtmlString, so {{ }} prints it as markup: no public view needs an unescaped echo, and nothing else can get there.
 */
final class SafeMarkdown
{
    /** A short prefix and its hyphen: one letter ("E-Mail"), an abbreviation in capitals ("QR-Code", "GPS-Position"), or a capitalised form of up to three letters ("App-Kennung", "USt-IdNr."). */
    private const SHORT_PREFIX = '/(^|[^\p{L}\p{N}])(\p{L}|\p{Lu}{2,4}|\p{Lu}[\p{Lu}\p{Ll}]{1,2})-(?=\p{L})/u';

    private const WORD_JOINER = "\u{2060}";

    /** "§" or "§§" and the white space before its number ("§ 27a", "§§ 19 und 21"). */
    private const PARAGRAPH_SIGN = '/(§§?)[ \t\r\n]+(?=\p{Nd})/u';

    private const NO_BREAK_SPACE = "\u{00A0}";

    public static function render(string $markdown): HtmlString
    {
        return new HtmlString(self::joinParagraphSigns(self::joinShortPrefixes((string) Str::markdown($markdown, [
            'html_input' => 'escape',
            'allow_unsafe_links' => false,
            'max_nesting_level' => 20,
        ]))));
    }

    /**
     * 03 §4 and DQ-145/DQ-220: a line never breaks after a short prefix ("QR- / Code", "E- / Mail"). A word joiner after the hyphen keeps
     * the halves together; the glyph stays the same and screen readers skip it. Only text between tags changes, never a tag, an attribute
     * or a link target, and code keeps its text. A word with "://" or "@" is an address someone may copy, so it stays whole. The app reads
     * the same documents with the same rule (mobile/src/features/settings/markdown/parse.ts).
     */
    public static function joinShortPrefixes(string $html): string
    {
        return self::mapText($html, function (string $text): string {
            if (! str_contains($text, '-')) {
                return $text;
            }

            // A PCRE failure (invalid UTF-8, a backtrack limit) returns null: the text then stays as it was, never blank.
            return preg_replace_callback('/\S+/u', fn (array $word): string => preg_match('~://|@~', $word[0]) === 1
                ? $word[0]
                : preg_replace(self::SHORT_PREFIX, '$1$2-'.self::WORD_JOINER, $word[0]) ?? $word[0], $text) ?? $text;
        });
    }

    /**
     * DQ-221, German typesetting: "§" and "§§" stay with their number, so no line ends on "nach §". A no-break space takes the place of the
     * space. It reads and copies as a space, and the source documents keep their ordinary one. Only text between tags changes, and code
     * keeps its text.
     */
    public static function joinParagraphSigns(string $html): string
    {
        return self::mapText($html, fn (string $text): string => str_contains($text, '§')
            ? preg_replace(self::PARAGRAPH_SIGN, '$1'.self::NO_BREAK_SPACE, $text) ?? $text
            : $text);
    }

    /**
     * Applies a rule to the text between tags, never to a tag, an attribute or the inside of code.
     *
     * @param  callable(string): string  $rule
     */
    private static function mapText(string $html, callable $rule): string
    {
        $parts = preg_split('/(<[^>]*>)/', $html, -1, PREG_SPLIT_DELIM_CAPTURE);

        if ($parts === false) {
            return $html;
        }

        $code = 0;

        foreach ($parts as $index => $part) {
            if (str_starts_with($part, '<')) {
                if (preg_match('~^<(/?)(code|pre)\b~i', $part, $tag) === 1) {
                    $code = max(0, $code + ($tag[1] === '/' ? -1 : 1));
                }

                continue;
            }

            if ($code === 0) {
                $parts[$index] = $rule($part);
            }
        }

        return implode('', $parts);
    }

    /**
     * A document that opens with "# Title" names itself: the page prints that title once as its own h1 (as text, through {{ }}), and the body
     * starts after it, so the page has one h1 and no repeated heading. Without such a line the title is null and the body stays whole.
     *
     * @return array{title: string|null, body: string}
     */
    public static function splitTitle(string $markdown): array
    {
        if (preg_match('/\A\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\R|\z)/u', $markdown, $match) !== 1) {
            return ['title' => null, 'body' => $markdown];
        }

        return ['title' => trim($match[1]), 'body' => ltrim(substr($markdown, strlen($match[0])))];
    }

    /**
     * Gives each h2 of rendered output an id. Its text comes out of the renderer escaped, and the id is a slug, so nothing new can get in.
     *
     * @return array{html: HtmlString, toc: list<array{id: string, title: string}>}
     */
    public static function withHeadingAnchors(HtmlString $rendered): array
    {
        $toc = [];

        $source = $rendered->toHtml();
        $html = preg_replace_callback('~<h2>(.*?)</h2>~s', function (array $match) use (&$toc): string {
            $title = html_entity_decode(strip_tags($match[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $id = 's'.(count($toc) + 1).'-'.Str::slug($title);
            $toc[] = ['id' => $id, 'title' => $title];

            return '<h2 id="'.$id.'">'.$match[1].'</h2>';
        }, $source);

        // On a PCRE failure the body stays whole, without anchors (and so without a table of contents), never blank.
        return $html === null
            ? ['html' => $rendered, 'toc' => []]
            : ['html' => new HtmlString($html), 'toc' => $toc];
    }
}
