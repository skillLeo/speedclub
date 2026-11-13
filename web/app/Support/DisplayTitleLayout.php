<?php

namespace App\Support;

use Illuminate\Support\HtmlString;
use Normalizer;

/**
 * ADR-426 (a) on the Blade pages: `display.title` shrinks only when shrinking saves a line, by the rule of
 * mobile/src/ui/displayTitleLayout.ts. ADR-425 as amended after code review round 3: the decision has one source on the app and
 * the public pages, this estimate with the same tables and thresholds, so /v/{slug} and / choose the size the app chooses
 * wherever the app decides from its estimate (everywhere except the platform cases it measures: Android 14+ above font scale 1,
 * a word wider than the line, no known width).
 *
 * - Placement "page": the full size (30/34, 44/48 on the web desktop) while the title needs at most 2 lines, else 24/28.
 * - Placement "card" (a title in a fixed card or on a photo band): 30/34 at every width while it fits 1 line; 24/28 when that
 *   brings it to exactly 1 line; otherwise the page rule at 30/34 (2 lines at 30 stay 30; 3 or more at 30 take 24).
 *
 * The line count is the app's estimate: the advances of the shipped Archivo SemiExpanded SemiBold with the role's −1 % tracking,
 * plus the font's positive pair kerning (KERNING; negative kerning is left out), so a line is never estimated narrower than the
 * screen draws it. Breaks only at U+0020 (a bound pair "VIII (CD)", "GT-R" or "C 63" is one word), greedy. A word wider than its
 * line breaks inside itself on the screen, so it counts as more lines than any threshold allows: an overflow at the full size
 * that disappears at 24 is a shrink. Balanced breaks (text-wrap: balance) keep the greedy line count.
 *
 * ADR-426 (c) as amended: a car name's trailing short code is bound to the word before it only when a breakable space remains
 * before that pair (KeepTogether::trailingPair) and the pair fits the line at the size the title is drawn at; the size rule
 * counts the lines of the text as it is then drawn.
 *
 * The page cannot run the rule per width, so `rules()` turns it into the container widths at which the title changes size or
 * binding and `css()` into container queries on the title's box (the container named sc-title, `.sc-title-box`, in px, since
 * the type sizes are px), per viewport range (phone < 768, tablet, desktop from 1280) and per font scale (1, and the QA scale 2
 * under :root[data-qa-font-scale="2"]). Pure, and the CSS holds only these numbers, the hashed class, fixed selectors and token
 * vars; `style()` hands it to Blade as it is (the stack sc-layout-css, printed in a nonced style element of
 * public/layouts/base.blade.php).
 */
final class DisplayTitleLayout
{
    public const PAGE = 'page';

    public const CARD = 'card';

    /** display.title: 30/34, 44/48 on the web desktop, at most 2 lines at the full size, else minSize/minLineHeight 24/28. */
    public const SIZE = 30;

    public const SIZE_DESKTOP = 44;

    public const MIN_SIZE = 24;

    public const MAX_LINES = 2;

    /** The role's tracking, −1 % at every size. */
    public const TRACKING_EM = -0.01;

    /** layout.breakpoints: tablet (768) and desktop (1280). */
    public const TABLET_WIDTH = 768;

    public const DESKTOP_WIDTH = 1280;

    /** The font scale the QA matrix asks for through :root[data-qa-font-scale="2"]. */
    public const QA_FONT_SCALE = 2;

    /**
     * Archivo SemiExpanded 600 (mobile/assets/fonts/ArchivoSemiExpanded-SemiBold.ttf, byte-identical to web/resources/fonts,
     * unitsPerEm 1000): advance width / unitsPerEm, rounded up to 3 decimals. display.title sets proportional figures (no tnum).
     * A letter with a diacritic takes its base letter's advance (NFD). U+202F is not in the cmap: the space stands in. Word joiner
     * and zero-width space draw nothing. The same table as DISPLAY_TITLE_ADVANCES of mobile/src/ui/displayTitleLayout.ts (ADR-426
     * parity, tested key by key, and against the font file).
     */
    public const ADVANCES = [
        '0' => 0.666, '1' => 0.623, '2' => 0.665, '3' => 0.669, '4' => 0.657, '5' => 0.668, '6' => 0.67, '7' => 0.634, '8' => 0.675, '9' => 0.669,
        '.' => 0.306, ',' => 0.306, "\u{2013}" => 0.563, "\u{2014}" => 1.125, '-' => 0.375, '/' => 0.302, '+' => 0.678, "\u{00D7}" => 0.678, "\u{2212}" => 0.678,
        ' ' => 0.26, "\u{00A0}" => 0.26, "\u{202F}" => 0.26, "\u{2060}" => 0, "\u{200B}" => 0,
        '(' => 0.353, ')' => 0.353, '&' => 0.827, "'" => 0.235, "\u{2019}" => 0.282, "\u{00B7}" => 0.376, ':' => 0.324, '!' => 0.305, '?' => 0.647, '"' => 0.438,
        "\u{201E}" => 0.49, "\u{201C}" => 0.49, '%' => 1.029, '#' => 0.661, '*' => 0.419, "\u{2033}" => 0.338, "\u{2032}" => 0.164, "\u{00B0}" => 0.4, "\u{00DF}" => 0.691,
        'A' => 0.809, 'B' => 0.801, 'C' => 0.834, 'D' => 0.831, 'E' => 0.769, 'F' => 0.699, 'G' => 0.904, 'H' => 0.849, 'I' => 0.314, 'J' => 0.642, 'K' => 0.801, 'L' => 0.643, 'M' => 0.978,
        'N' => 0.849, 'O' => 0.9, 'P' => 0.763, 'Q' => 0.9, 'R' => 0.819, 'S' => 0.759, 'T' => 0.717, 'U' => 0.834, 'V' => 0.768, 'W' => 1.073, 'X' => 0.8, 'Y' => 0.769, 'Z' => 0.734,
        'a' => 0.648, 'b' => 0.661, 'c' => 0.636, 'd' => 0.661, 'e' => 0.653, 'f' => 0.368, 'g' => 0.66, 'h' => 0.65, 'i' => 0.266, 'j' => 0.264, 'k' => 0.615, 'l' => 0.266, 'm' => 0.993,
        'n' => 0.65, 'o' => 0.672, 'p' => 0.661, 'q' => 0.661, 'r' => 0.4, 's' => 0.604, 't' => 0.382, 'u' => 0.65, 'v' => 0.591, 'w' => 0.865, 'x' => 0.615, 'y' => 0.591, 'z' => 0.57,
    ];

    /**
     * SF-R3-2, ADR-425 as amended: the positive pair kerning of the same font, in em. Per ordered pair of the characters the
     * estimate covers (A–Z, a–z, 0–9, . , – - / + × ( ) & ' and the spaces) the largest XAdvance adjustment the 'kern' feature's
     * PairPos lookups (formats 1 and 2) can apply, kept where it is above 0, / unitsPerEm, rounded up to 3 decimals; derived with
     * fontTools 4.68 and tested against the font file (Tests\Support\TrueTypeAdvances) and against DISPLAY_TITLE_KERNING of the
     * app, pair by pair. Added between two adjacent drawn characters (a glyph that draws nothing is passed over, as the shaper
     * skips it), so the estimate is never below the drawn width.
     */
    public const KERNING = [
        '-0' => 0.04, '-1' => 0.04, '-2' => 0.04, '-3' => 0.04, '-4' => 0.04, '-5' => 0.04, '-6' => 0.04, '-8' => 0.03, '-9' => 0.02, "0'" => 0.005,
        '0-' => 0.04, "0\u{2013}" => 0.04, '1-' => 0.04, "1\u{2013}" => 0.04, '2-' => 0.01, "2\u{2013}" => 0.01, '3-' => 0.04, "3\u{2013}" => 0.04, '4-' => 0.04, "4\u{2013}" => 0.04,
        '5-' => 0.04, "5\u{2013}" => 0.04, '6-' => 0.02, "6\u{2013}" => 0.02, '8-' => 0.03, "8\u{2013}" => 0.03, '9-' => 0.04, "9\u{2013}" => 0.04, 'A/' => 0.035, 'K/' => 0.035,
        'L/' => 0.035, "f'" => 0.01, 'f)' => 0.025, 'f7' => 0.025, 't)' => 0.008, "\u{2013}0" => 0.04, "\u{2013}1" => 0.04, "\u{2013}2" => 0.04, "\u{2013}3" => 0.04, "\u{2013}4" => 0.04,
        "\u{2013}5" => 0.04, "\u{2013}6" => 0.04, "\u{2013}8" => 0.03, "\u{2013}9" => 0.02,
    ];

    /** Float noise in a sum of advances: a line exactly as wide as its box fits (the thresholds are such sums, rounded up). */
    public const EPSILON = 1e-6;

    /** N-R3-1: the container name of `.sc-title-box` (public.css), the only container the title's queries read. */
    public const CONTAINER = 'sc-title';

    private const NO_BREAK_SPACE = "\u{00A0}";

    /** The viewport ranges a title may be placed differently in, with their media queries (min-/max-width: no media range syntax). */
    private const RANGES = [
        'phone' => ['media' => '(max-width: 767.98px)', 'desktop' => false],
        'tablet' => ['media' => '(min-width: 768px) and (max-width: 1279.98px)', 'desktop' => false],
        'desktop' => ['media' => '(min-width: 1280px)', 'desktop' => true],
    ];

    /** phone and tablet as one range, when they place the title alike. */
    private const NARROW_MEDIA = '(max-width: 1279.98px)';

    /** Any other character: the widest letter of the table (W), so an unknown glyph never makes a line look shorter than it is. */
    public static function fallbackEm(): float
    {
        $widest = 0.0;

        foreach (self::ADVANCES as $char => $em) {
            $widest = preg_match('/^\p{L}$/u', (string) $char) === 1 ? max($widest, (float) $em) : $widest;
        }

        return $widest;
    }

    /** The table character a character is measured as: itself, else its base letter (NFD), else null (the fallback width). */
    public static function tableChar(string $char): ?string
    {
        if (isset(self::ADVANCES[$char])) {
            return $char;
        }

        $decomposed = Normalizer::normalize($char, Normalizer::FORM_D);
        $base = is_string($decomposed) && $decomposed !== '' ? mb_substr($decomposed, 0, 1) : null;

        return $base !== null && isset(self::ADVANCES[$base]) ? $base : null;
    }

    /** One character's advance in em, tracking included (nothing for a glyph that draws nothing). */
    public static function advance(string $char): float
    {
        $own = self::tableChar($char);
        $em = $own === null ? self::fallbackEm() : (float) self::ADVANCES[$own];

        return $em === 0.0 ? 0.0 : $em + self::TRACKING_EM;
    }

    /** The positive kerning between two drawn characters, each as its table character (0 for a pair the table does not list). */
    public static function kerning(string $left, string $right): float
    {
        $a = self::tableChar($left);
        $b = self::tableChar($right);

        return $a === null || $b === null ? 0.0 : (float) (self::KERNING[$a.$b] ?? 0.0);
    }

    /**
     * The estimated width of a text in display.title at `$fontSize`: advances, tracking and the positive pair kerning between
     * adjacent drawn characters, a letter with a diacritic as its base letter (a glyph that draws nothing, such as the word
     * joiner, does not end a pair: the shaper kerns across it).
     */
    public static function width(string $text, float $fontSize): float
    {
        $em = 0.0;
        $previous = null;

        foreach (mb_str_split($text) as $char) {
            $advance = self::advance($char);

            if ($advance === 0.0) {
                continue;
            }

            $em += $advance + ($previous === null ? 0.0 : self::kerning($previous, $char));
            $previous = $char;
        }

        return $em * $fontSize;
    }

    /**
     * The words a title may break between: at U+0020 only. U+00A0 and the word joiner keep their words whole.
     *
     * @return list<string>
     */
    public static function words(string $text): array
    {
        return array_values(array_filter(explode(' ', $text), fn (string $word): bool => $word !== ''));
    }

    /**
     * The lines a title takes when it breaks only at its spaces, greedily, each word at its estimated width. A word wider than
     * the line counts as one line here, and `overflow` reports it: the screen would break inside it.
     *
     * @return array{lines: int, overflow: bool}
     */
    public static function lines(string $text, float $fontSize, float $width): array
    {
        $space = self::width(' ', $fontSize);
        $lines = 0;
        $line = 0.0;
        $overflow = false;

        foreach (self::words($text) as $word) {
            $wordWidth = self::width($word, $fontSize);
            $overflow = $overflow || $wordWidth > $width + self::EPSILON;

            if ($lines === 0) {
                [$lines, $line] = [1, $wordWidth];
            } elseif ($line + $space + $wordWidth > $width + self::EPSILON) {
                [$lines, $line] = [$lines + 1, $wordWidth];
            } else {
                $line += $space + $wordWidth;
            }
        }

        return ['lines' => max(1, $lines), 'overflow' => $overflow];
    }

    /** The lines the screen draws by the estimate: a word wider than its line breaks inside itself, so it never fits any count. */
    public static function lineCount(string $text, float $fontSize, float $width): int
    {
        $estimate = self::lines($text, $fontSize, $width);

        return $estimate['overflow'] ? PHP_INT_MAX : $estimate['lines'];
    }

    /**
     * The narrowest width at which the title takes at most `$lines` lines at `$fontSize`, no word wider than a line. The greedy
     * count only changes where a line's run of words ends, so the candidates are the widths of every run of consecutive words.
     */
    public static function minWidth(string $text, float $fontSize, int $lines): float
    {
        $words = self::words($text);

        if ($words === []) {
            return 0.0;
        }

        $space = self::width(' ', $fontSize);
        $widths = array_map(fn (string $word): float => self::width($word, $fontSize), $words);
        $candidates = [];

        foreach ($widths as $start => $first) {
            $run = $first;
            $candidates[] = $run;

            for ($end = $start + 1; $end < count($widths); $end++) {
                $run += $space + $widths[$end];
                $candidates[] = $run;
            }
        }

        $candidates = array_values(array_unique($candidates, SORT_REGULAR));
        rsort($candidates);
        // The widest run is one line; walk down while the count still holds, so the answer is where it stops holding.
        $answer = $candidates[0];

        foreach ($candidates as $candidate) {
            if (self::lineCount($text, $fontSize, $candidate) > $lines) {
                break;
            }

            $answer = $candidate;
        }

        return $answer;
    }

    /** The unscaled full size of a placement: the desktop size for a page title on the web desktop, else 30. */
    public static function fullSize(string $placement, bool $desktop): int
    {
        return $placement === self::PAGE && $desktop ? self::SIZE_DESKTOP : self::SIZE;
    }

    /**
     * The text as it is drawn at `$fontSize` in a line `$width` wide: with `$bind` (a car name) its trailing code bound to the
     * word before it where ADR-426 c binds it (KeepTogether::bindTrailingCode), else as it is.
     */
    public static function shown(string $text, float $fontSize, float $width, bool $bind): string
    {
        return $bind ? KeepTogether::bindTrailingCode($text, $width, $fontSize) : $text;
    }

    /**
     * The rule at one width: the size the title is drawn at (times the font scale), as the app decides it; whether it is drawn
     * smaller than its full size; and, for a car name with a bindable trailing pair (`$bind`), whether that pair is bound at
     * that size (null when there is nothing to bind).
     *
     * @return array{size: float, shrunk: bool, bound: bool|null}
     */
    public static function state(string $text, float $width, string $placement, bool $desktop, float $fontScale = 1.0, bool $bind = false): array
    {
        $full = self::fullSize($placement, $desktop) * $fontScale;
        $min = self::MIN_SIZE * $fontScale;
        $lines = fn (float $size): int => self::lineCount(self::shown($text, $size, $width, $bind), $size, $width);

        if ($placement === self::CARD && $lines($full) === 1) {
            $size = $full;
        } elseif ($placement === self::CARD && $lines($min) === 1) {
            $size = $min;
        } else {
            $size = $lines($full) <= self::MAX_LINES ? $full : $min;
        }

        $bindable = $bind && KeepTogether::trailingPair($text) !== null;

        return ['size' => $size, 'shrunk' => $size !== $full, 'bound' => $bindable ? self::shown($text, $size, $width, true) !== $text : null];
    }

    /** The size of `state()`. */
    public static function size(string $text, float $width, string $placement, bool $desktop, float $fontScale = 1.0, bool $bind = false): float
    {
        return self::state($text, $width, $placement, $desktop, $fontScale, $bind)['size'];
    }

    /**
     * The rule as container widths: the state from the widest container down, each step with the width below which it applies
     * (null for the first, which holds at any width above the next). `state()` gives exactly these states. The state only changes
     * where a line count at 30 (44) or 24 crosses 1 or 2 lines, for the text bound or not, or where the bound pair stops fitting
     * its line, so it is evaluated at those widths (and below the narrowest).
     *
     * @return list<array{belowPx: float|null, shrunk: bool, bound: bool|null}>
     */
    public static function rules(string $text, string $placement, bool $desktop, float $fontScale = 1.0, bool $bind = false): array
    {
        $pair = $bind ? KeepTogether::trailingPair($text) : null;
        $variants = $pair === null ? [$text] : [$text, KeepTogether::bindTrailingCode($text)];
        $candidates = [];

        foreach ([self::fullSize($placement, $desktop) * $fontScale, self::MIN_SIZE * $fontScale] as $size) {
            foreach ($variants as $variant) {
                $candidates[] = self::minWidth($variant, $size, 1);
                $candidates[] = self::minWidth($variant, $size, self::MAX_LINES);
            }

            if ($pair !== null) {
                $candidates[] = self::width($pair[1].self::NO_BREAK_SPACE.$pair[2], $size);
            }
        }

        $candidates = array_values(array_unique(array_filter($candidates, fn (float $width): bool => $width > 0.0), SORT_REGULAR));
        rsort($candidates);
        $at = fn (float $width): array => self::state($text, $width, $placement, $desktop, $fontScale, $bind);
        $first = $at($candidates[0] ?? 0.0);
        $rules = [['belowPx' => null, 'shrunk' => $first['shrunk'], 'bound' => $first['bound']]];

        foreach ($candidates as $index => $threshold) {
            // Below this width the state of the next narrower candidate holds (or of no width at all, below the last).
            $below = $at($candidates[$index + 1] ?? 0.0);
            $last = $rules[array_key_last($rules)];

            if ($below['shrunk'] !== $last['shrunk'] || $below['bound'] !== $last['bound']) {
                $rules[] = ['belowPx' => self::px($threshold), 'shrunk' => $below['shrunk'], 'bound' => $below['bound']];
            }
        }

        return $rules;
    }

    /**
     * The placements of one call site per viewport range, completed: phone < 768, tablet 768–1279, desktop from 1280.
     *
     * @param  array{phone?: string, tablet?: string, desktop?: string}|string  $placements
     * @return array{phone: string, tablet: string, desktop: string}
     */
    public static function placements(array|string $placements): array
    {
        $given = is_string($placements) ? ['phone' => $placements] : $placements;
        $phone = self::placement($given['phone'] ?? self::PAGE);
        $tablet = self::placement($given['tablet'] ?? $phone);

        return ['phone' => $phone, 'tablet' => $tablet, 'desktop' => self::placement($given['desktop'] ?? $tablet)];
    }

    /**
     * Every regime of one title: per font scale (1 and the QA scale 2) and viewport range, the media query, the placement and the
     * rules. Phone and tablet share one range when they place the title alike.
     *
     * @param  array{phone?: string, tablet?: string, desktop?: string}|string  $placements
     * @return array<int, list<array{media: string, placement: string, rules: list<array{belowPx: float|null, shrunk: bool, bound: bool|null}>}>>
     */
    public static function breakpoints(string $text, array|string $placements, bool $bind = false): array
    {
        $placements = self::placements($placements);
        $ranges = $placements['phone'] === $placements['tablet']
            ? ['narrow' => ['media' => self::NARROW_MEDIA, 'desktop' => false, 'placement' => $placements['phone']], 'desktop' => [...self::RANGES['desktop'], 'placement' => $placements['desktop']]]
            : array_map(fn (array $range, string $key): array => [...$range, 'placement' => $placements[$key]], self::RANGES, array_keys(self::RANGES));
        $regimes = [];

        foreach ([1 => 1.0, self::QA_FONT_SCALE => (float) self::QA_FONT_SCALE] as $scaleKey => $scale) {
            $regimes[$scaleKey] = array_values(array_map(fn (array $range): array => [
                'media' => $range['media'],
                'placement' => $range['placement'],
                'rules' => self::rules($text, $range['placement'], $range['desktop'], $scale, $bind),
            ], $ranges));
        }

        return $regimes;
    }

    /**
     * @param  array{phone?: string, tablet?: string, desktop?: string}|string  $placements
     */
    public static function className(string $text, array|string $placements, bool $bind = false): string
    {
        return 'sc-title--'.hash('xxh32', json_encode(self::breakpoints($text, $placements, $bind), JSON_THROW_ON_ERROR));
    }

    /**
     * The title's sizes as CSS: per scale and viewport range the widest state, then the container queries of its rules (the
     * narrower comes later and wins), on the container named sc-title only (N-R3-1: no other size container in between can take
     * the query). Scale 1 under `.sc-display-title.{class}`, the QA scale 2 under `:root[data-qa-font-scale="2"]
     * .sc-display-title.{class}` (more specific, so it wins at every width). A bindable title's pair span (`.sc-bind`, printed by
     * KeepTogether::title) gets white-space nowrap where the pair is bound and normal where it is not, in every state.
     *
     * @param  array{phone?: string, tablet?: string, desktop?: string}|string  $placements
     */
    public static function css(string $text, string $class, array|string $placements, bool $bind = false): string
    {
        $css = '';
        $scopes = [1 => '.sc-display-title.'.$class, self::QA_FONT_SCALE => ':root[data-qa-font-scale="'.self::QA_FONT_SCALE.'"] .sc-display-title.'.$class];

        foreach (self::breakpoints($text, $placements, $bind) as $scaleKey => $ranges) {
            $scope = $scopes[$scaleKey];

            foreach ($ranges as $range) {
                $block = '';

                foreach ($range['rules'] as $rule) {
                    $declaration = $scope.'{'.self::declaration($rule['shrunk'] ? 'shrink' : ($range['placement'] === self::CARD ? 'base' : 'full')).'}'
                        .($rule['bound'] === null ? '' : $scope.' .sc-bind{white-space:'.($rule['bound'] ? 'nowrap' : 'normal').'}');
                    $block .= $rule['belowPx'] === null ? $declaration : '@container '.self::CONTAINER.' (width < '.self::number($rule['belowPx']).'px){'.$declaration.'}';
                }

                $css .= '@media '.$range['media'].'{'.$block.'}';
            }
        }

        return $css;
    }

    /**
     * `css()` for a style element: trusted markup, so `{{ }}` keeps "<" and the quotes, and it can never end its element.
     *
     * @param  array{phone?: string, tablet?: string, desktop?: string}|string  $placements
     */
    public static function style(string $text, string $class, array|string $placements, bool $bind = false): HtmlString
    {
        return new HtmlString(str_ireplace('</style', '<\/style', self::css($text, $class, $placements, $bind)));
    }

    private static function placement(string $placement): string
    {
        return $placement === self::CARD ? self::CARD : self::PAGE;
    }

    /** The size, leading and tracking of one variant: the role (44 from 1280), its phone pair at every width, or 24/28. */
    private static function declaration(string $variant): string
    {
        $prefix = '--sc-type-display-title'.match ($variant) {
            'shrink' => '-shrink',
            'base' => '-base',
            default => '',
        };

        return 'font-size:var('.$prefix.'-size);line-height:var('.$prefix.'-line);letter-spacing:var('.$prefix.'-tracking)';
    }

    /**
     * Up to two decimals, rounded up: a threshold is where the title changes size, so rounding up never claims a fit the estimate
     * denies; tiny float errors do not cost a step.
     */
    private static function px(float $value): float
    {
        return ceil($value * 100 - 1e-6) / 100;
    }

    private static function number(float $value): string
    {
        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
    }
}
