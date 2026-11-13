<?php

namespace App\Support;

use Illuminate\Support\HtmlString;

/**
 * §4 "never break key data" on the Blade pages. `name()` (DQ-047, DQ-181): a model name such as "Skyline GT-R R34" or
 * "Mazda RX-7" may wrap at its spaces, never at a hyphen inside a name ("GT-" / "R"). The rule of keepNameTogether in
 * mobile/src/lib/format.ts (a hyphen between two letters or figures), applied as markup: each such word sits in a span that
 * does not wrap, so the text itself stays exactly the name. Crawlers, copy and paste and the Blade/app parity test read
 * "GT-R", and JSON-LD, meta tags and URLs never see this, because they take the plain string. `figures()` (DQ-229) keeps a
 * figure with its unit. Display only, and only through `{{ }}`, which keeps the escaping. `nameText()` binds what vehicleNameText
 * in mobile/src/ui/textBreaks.ts binds with U+00A0, a model letter and its figure ("C 63", DQ-310). `title()` also keeps a
 * display title's trailing short code with the word before it, as vehicleTitleText does ("GT-R R34", "VIII (CD)", ADR-426 c as
 * amended), but only where the rule binds: never when no breakable space remains before the pair ("Porsche 911" stays
 * breakable), and per width only where the pair fits the line at the size it is drawn, which DisplayTitleLayout's container
 * queries switch on the pair's span (`.sc-bind`). The text itself stays the plain name.
 */
final class KeepTogether
{
    private const NAME_HYPHEN = '/[\p{L}\p{N}]-[\p{L}\p{N}]/u';

    private const NO_BREAK_SPACE = "\u{00A0}";

    /** U+2060: no line break on either side, draws nothing (the joiner keepNameTogether of mobile/src/lib/format.ts puts after a name's hyphen). */
    private const WORD_JOINER = "\u{2060}";

    /** A hyphen between two letters or figures without a word joiner after it yet (NAME_HYPHEN of mobile/src/lib/format.ts). */
    private const JOINABLE_HYPHEN = '/([\p{L}\p{N}])-(?!\x{2060})(?=[\p{L}\p{N}])/u';

    /** A run of letters and figures joined by in-word hyphens: "speed-club", "Slip-On". */
    private const HYPHEN_RUN = '/([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+)/u';

    /** keepShortNamesTogether of mobile/src/lib/format.ts: a hyphenated word up to this long fits a column at 200 % ("Hi-Power"). */
    public const SHORT_NAME_LENGTH = 12;

    /**
     * Where an identifier may wrap (DQ-927): after "." or "_" (as handleText of mobile/src/ui/textBreaks.ts) and after an "@" that
     * does not start it ("lukas.sc@" / "speed-club.test"), each only before something visible.
     */
    private const IDENTIFIER_BREAK = '/(?<=[._])(?=\S)|(?<=\S@)(?=\S)/u';

    /** One or two capitals standing alone, then a space and a figure: the "C" of "C 63 AMG", the "A" of "A 45 S" (DQ-310). */
    private const MODEL_LETTER = '/(^|\s)(\p{Lu}{1,2}) (?=\p{N})/u';

    /** ADR-426 (c): a display title's last token this short ("R34", "(CD)", "G82") stays with the word before it (TRAILING_CODE_MAX). */
    public const TRAILING_CODE_MAX = 4;

    /** Characters that draw nothing and do not count towards the code's length (word joiner, zero-width space). */
    private const INVISIBLE = '/[\x{2060}\x{200B}]/u';

    /** A figure with at most two letters around it, the way dimensions are written: "2.568", "−35", "19″", "9,5J", "ET35", "255/35", "R19". */
    private const FIGURE = '/^[−+-]?[A-Za-z]{0,2}[0-9][0-9.,\/]*[A-Za-z]{0,2}[″′°%]?$/u';

    private const VALUE_SEPARATOR = '/^[×·→\/]$/u';

    private const UNIT = '/^(?:mm|cm|cm³|ccm|m|km|km\/h|l|kg|t|bar|psi|PS|kW|hp|Nm|U\/min|V|Ah|W|dB|Zoll|°|%)$/u';

    /** The separators a line of values may wrap after. */
    private const LINE_CUT = '/^[·→]$/u';

    private const TRAILING_PUNCTUATION = '/[.,;:!?)]+$/u';

    public static function name(?string $name): HtmlString
    {
        return self::nameMarkup(self::nameText($name));
    }

    /**
     * A car name as display.title sets it: `name()` of the trimmed name, and a bindable trailing pair (`trailingPair()`) in a
     * `.sc-bind` span joined by its plain space. The span does not wrap where DisplayTitleLayout::css() binds the pair at that
     * width and size, and wraps freely where it does not; the text is `titleText()` either way.
     */
    public static function title(?string $name): HtmlString
    {
        $text = self::titleText($name);
        $pair = self::trailingPair($text);

        if ($pair === null) {
            return self::nameMarkup($text);
        }

        [$head, $word, $code] = $pair;

        return new HtmlString(self::nameMarkup($head)->toHtml().' <span class="sc-bind">'.self::nameMarkup($word)->toHtml().' '.self::nameMarkup($code)->toHtml().'</span>');
    }

    /**
     * DQ-926: a vehicle, part or brand name interpolated into running text (a translation's ":name"), as plain text, so `__()` and
     * `{{ }}` keep escaping it. The rule of vehicleNameText in mobile/src/ui/textBreaks.ts: a word joiner (U+2060) after an in-word
     * hyphen ("GT-R", the joiner keepNameTogether writes), a model letter bound to its figure ("C 63"), and a trailing short code
     * bound to the word before it by ADR-426 c ("GT-R R34"), only where a breakable space remains before the pair (`trailingPair()`);
     * at a running text's size the pair always fits its line. Never for meta tags, JSON-LD or aria labels: those take the plain name.
     */
    public static function inlineName(?string $name): string
    {
        $text = self::titleText($name);
        $pair = self::trailingPair($text);

        if ($pair !== null) {
            $text = $pair[0].' '.$pair[1].self::NO_BREAK_SPACE.$pair[2];
        }

        return preg_replace(self::JOINABLE_HYPHEN, '$1-'.self::WORD_JOINER, $text) ?? $text;
    }

    /**
     * keepNameTogether of mobile/src/lib/format.ts as markup, for a line that is or holds a name but is set whole (a sub-line, a
     * person's display name): every word with an in-word hyphen sits in a `.sc-keep` span, nothing else changes, not even "C 63".
     */
    public static function words(?string $text): HtmlString
    {
        return self::nameMarkup((string) $text);
    }

    /**
     * keepShortNamesTogether of mobile/src/lib/format.ts as markup, for text that may hold a model name but is not one (a mod's name,
     * ModRow.tsx): a hyphenated word of at most SHORT_NAME_LENGTH characters stays whole ("HKS Hi-Power", "Slip-On"), a longer one
     * keeps its hyphen as the place to wrap ("Aero-Seitenschweller"), and an address someone may copy is left alone.
     */
    public static function shortNames(?string $text): HtmlString
    {
        $html = '';

        foreach (self::split((string) $text) as $part) {
            $keep = mb_strlen($part) <= self::SHORT_NAME_LENGTH && preg_match('~://|@~u', $part) !== 1 && preg_match(self::NAME_HYPHEN, $part) === 1;
            $html .= $keep ? '<span class="sc-keep">'.e($part).'</span>' : e($part);
        }

        return new HtmlString($html);
    }

    /**
     * DQ-927: an e-mail address, a handle ("@lukas.sc"), a URL or a reference shown as it is stored, never altered by the layout:
     * in a `.sc-ident` span (public.css: no automatic hyphens), wrapping only after "." and "_" and after an inner "@" (an empty
     * `<wbr>`, so copy and paste and screen readers get the address unchanged), never at a hyphen inside it ("speed-club" sits in
     * a `.sc-keep` span). A URL also keeps the browser's own break after "/", which adds nothing to the address either. Without
     * `$breaks` the identifier stays one word, as the app's OwnerRow sets the handle (the Blade/app parity test reads its text
     * runs; at a large font the actions move under the name instead, and only a handle wider than a whole line breaks anywhere).
     */
    public static function identifier(?string $value, bool $breaks = true): HtmlString
    {
        $text = (string) $value;

        if ($text === '') {
            return new HtmlString('');
        }

        $pieces = $breaks ? preg_split(self::IDENTIFIER_BREAK, $text) : [$text];
        $html = [];

        foreach ($pieces === false ? [$text] : $pieces as $piece) {
            $runs = preg_split(self::HYPHEN_RUN, $piece, -1, PREG_SPLIT_DELIM_CAPTURE);
            $markup = '';

            foreach ($runs === false ? [$piece] : $runs as $index => $run) {
                $markup .= $index % 2 === 1 ? '<span class="sc-keep">'.e($run).'</span>' : e($run);
            }

            $html[] = $markup;
        }

        return new HtmlString('<span class="sc-ident">'.implode('<wbr>', $html).'</span>');
    }

    /**
     * A translated sentence with identifiers in it (DQ-927): `__($key, $replace)` with each of `$identifiers` printed through
     * `identifier()`. The line is escaped first, then the placeholders take their markup, so only the identifiers' own spans
     * reach the page. Names in `$replace` go through `inlineName()` at the call site.
     *
     * @param  array<string, string|int|float>  $replace
     * @param  array<string, string>  $identifiers
     */
    public static function sentence(string $key, array $replace = [], array $identifiers = []): HtmlString
    {
        $markup = [];
        $index = 0;

        foreach ($identifiers as $placeholder => $value) {
            $token = "\u{E000}".$index++."\u{E001}";
            $replace[$placeholder] = $token;
            $markup[$token] = self::identifier($value)->toHtml();
        }

        $line = __($key, $replace);

        return new HtmlString(strtr(e(is_string($line) ? $line : $key), $markup));
    }

    private static function nameMarkup(string $text): HtmlString
    {
        $parts = self::split($text);
        $html = '';

        foreach ($parts as $part) {
            $html .= preg_match(self::NAME_HYPHEN, $part) === 1 ? '<span class="sc-keep">'.e($part).'</span>' : e($part);
        }

        return new HtmlString($html);
    }

    /** The name as text with its model letters bound ("C<U+00A0>63"): what `name()` prints, without its markup. */
    public static function nameText(?string $name): string
    {
        $text = (string) $name;

        return preg_replace(self::MODEL_LETTER, '$1$2'.self::NO_BREAK_SPACE, $text) ?? $text;
    }

    /**
     * What `title()` prints, without its markup: the trimmed name with its model letters bound, and what DisplayTitleLayout
     * estimates (it binds the trailing pair per size and width itself, `DisplayTitleLayout::shown()`).
     */
    public static function titleText(?string $name): string
    {
        return self::nameText(preg_replace('/^\s+|\s+$/u', '', (string) $name) ?? (string) $name);
    }

    /**
     * ADR-426 c as amended: the trailing pair a display title may bind, as [the text before it, the word, the code], where
     * `$text` is exactly head + U+0020 + word + U+0020 + code. Only when the last token after a plain space has 1 to
     * TRAILING_CODE_MAX visible characters and a breakable space (U+0020) remains before the word it would join, after
     * something visible (bindTrailingCode of textBreaks.ts, step by step): "Skyline GT-R R34" → ["Skyline", "GT-R", "R34"];
     * "Porsche 911", "Toyota GR86", "Mercedes-Benz W124" → null.
     *
     * @return array{0: string, 1: string, 2: string}|null
     */
    public static function trailingPair(string $text): ?array
    {
        $at = strrpos($text, ' ');

        if ($at === false || $at === 0) {
            return null;
        }

        $code = substr($text, $at + 1);
        $before = substr($text, 0, $at);
        $visible = mb_strlen(preg_replace(self::INVISIBLE, '', $code) ?? $code);
        $space = strrpos($before, ' ');

        if ($visible === 0 || $visible > self::TRAILING_CODE_MAX || $space === false || self::blank($before)) {
            return null;
        }

        $head = substr($before, 0, $space);

        return self::blank($head) ? null : [$head, substr($before, $space + 1), $code];
    }

    /** Nothing but white space, as JavaScript's trim() reads it (U+00A0 and U+202F included), so both sides bind alike. */
    private static function blank(string $text): bool
    {
        return preg_match('/^[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]*$/u', $text) === 1;
    }

    /**
     * bindTrailingCode of mobile/src/ui/textBreaks.ts: the trailing pair (`trailingPair()`) joined with U+00A0. "Skyline GT-R R34"
     * → "Skyline GT-R R34". With a line width and a font size it binds only where the pair, as display.title draws it at that
     * size (DisplayTitleLayout::width()), fits the line; otherwise the text stays as it is.
     */
    public static function bindTrailingCode(string $text, ?float $lineWidth = null, ?float $fontSize = null): string
    {
        $pair = self::trailingPair($text);

        if ($pair === null) {
            return $text;
        }

        [$head, $word, $code] = $pair;
        $bound = $word.self::NO_BREAK_SPACE.$code;

        if ($lineWidth !== null && $fontSize !== null && DisplayTitleLayout::width($bound, $fontSize) > $lineWidth + DisplayTitleLayout::EPSILON) {
            return $text;
        }

        return $head.' '.$bound;
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
