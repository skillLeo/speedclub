<?php

namespace App\Support;

use Illuminate\Support\HtmlString;

/**
 * §4 "never break key data" on the Blade pages. `name()` (DQ-047, DQ-181): a model name such as "Skyline GT-R R34" or
 * "Mazda RX-7" may wrap at its spaces, never at a hyphen inside a name ("GT-" / "R"). The rule of keepNameTogether in
 * mobile/src/lib/format.ts (a hyphen between two letters or figures), applied as markup: each such word sits in a span that
 * does not wrap, so the text itself stays exactly the name. Crawlers, copy and paste and the Blade/app parity test read
 * "GT-R", and JSON-LD, meta tags and URLs never see this, because they take the plain string. `figures()` (DQ-229) keeps a
 * figure with its unit. Display only, and only through `{{ }}`, which keeps the escaping.
 */
final class KeepTogether
{
    private const NAME_HYPHEN = '/[\p{L}\p{N}]-[\p{L}\p{N}]/u';

    private const NO_BREAK_SPACE = "\u{00A0}";

    /** A figure with at most two letters around it, the way dimensions are written: "2.568", "−35", "19″", "9,5J", "ET35", "255/35", "R19". */
    private const FIGURE = '/^[−+-]?[A-Za-z]{0,2}[0-9][0-9.,\/]*[A-Za-z]{0,2}[″′°%]?$/u';

    private const VALUE_SEPARATOR = '/^[×·→\/]$/u';

    private const UNIT = '/^(?:mm|cm|cm³|ccm|m|km|km\/h|l|kg|t|bar|psi|PS|kW|hp|Nm|U\/min|V|Ah|W|dB|Zoll|°|%)$/u';

    /** The separators a line of values may wrap after. */
    private const LINE_CUT = '/^[·→]$/u';

    private const TRAILING_PUNCTUATION = '/[.,;:!?)]+$/u';

    public static function name(?string $name): HtmlString
    {
        $parts = self::split((string) $name);
        $html = '';

        foreach ($parts as $part) {
            $html .= preg_match(self::NAME_HYPHEN, $part) === 1 ? '<span class="sc-keep">'.e($part).'</span>' : e($part);
        }

        return new HtmlString($html);
    }

    /**
     * DQ-229, the Blade twin of DQ-216 and a port of keepFiguresTogether in mobile/src/lib/format.ts, for a line of values
     * such as a Verlauf change or the key values of a mod row. A figure keeps its unit through a no-break space (U+00A0):
     * "356 mm", "−35 mm", "130 PS". A longer run of values ("18″ × 9,5J ET22", "265/35 R18") sits in a `.sc-run` span:
     * it moves to the next line whole, and only when it is wider than a whole line, as at a 200 % font, does it wrap at
     * its own spaces. That is what keepFiguresTogether does with `wholeRuns` on and off; the page cannot know the font
     * scale, the layout can. A value with a slash ("265/35", "U/min") never breaks after the slash (`.sc-keep`). Words
     * wrap at their spaces, a line wraps after its cuts "·" and "→" and never before them (as valueSegments keeps them
     * on the app), and line breaks stay. The text itself is as written, double spaces too, except where a no-break space joins, and it is escaped, so only `{{ }}` prints it.
     */
    public static function figures(?string $line): HtmlString
    {
        $parts = self::split((string) $line);
        $html = '';
        $run = '';
        $wrapRun = false;

        for ($i = 0; $i < count($parts); $i += 2) {
            $token = $parts[$i];
            $run .= self::isValueToken(self::bare($token)) && str_contains($token, '/') ? '<span class="sc-keep">'.e($token).'</span>' : e($token);
            $space = $parts[$i + 1] ?? null;
            $next = $parts[$i + 2] ?? '';

            $spaces = $space !== null && $token !== '' && preg_match('/^ +$/', $space) === 1;

            if ($spaces && self::isValueToken($token) && self::isValueToken(self::bare($next))) {
                $pair = preg_match(self::FIGURE, $token) === 1 && preg_match(self::UNIT, self::bare($next)) === 1;
                $run .= $pair ? self::NO_BREAK_SPACE : (string) $space;
                $wrapRun = $wrapRun || ! $pair;

                continue;
            }

            if ($spaces && preg_match(self::LINE_CUT, $next) === 1) {
                $run .= self::NO_BREAK_SPACE;

                continue;
            }

            $html .= $wrapRun ? '<span class="sc-run">'.$run.'</span>' : $run;
            $html .= e((string) $space);
            $run = '';
            $wrapRun = false;
        }

        return new HtmlString($html);
    }

    /**
     * Words and the whitespace between them. Text PCRE cannot read (invalid UTF-8) stays one word, so it is printed escaped as
     * it is instead of vanishing (M1.9).
     *
     * @return list<string>
     */
    private static function split(string $text): array
    {
        $parts = preg_split('/(\s+)/u', $text, -1, PREG_SPLIT_DELIM_CAPTURE);

        return $parts === false ? [$text] : $parts;
    }

    /** A token without the punctuation of the sentence after it: "mm." is "mm". */
    private static function bare(string $token): string
    {
        return preg_replace(self::TRAILING_PUNCTUATION, '', $token) ?? $token;
    }

    private static function isValueToken(string $token): bool
    {
        return preg_match(self::LINE_CUT, $token) !== 1
            && (preg_match(self::FIGURE, $token) === 1 || preg_match(self::VALUE_SEPARATOR, $token) === 1 || preg_match(self::UNIT, $token) === 1);
    }
}
