<?php

namespace App\Support;

use Illuminate\Support\HtmlString;

/**
 * DQ-801 on the Blade pages: the FS-3 spec strip (09 §5 SpecStrip) takes its columns by fit, by the rule of
 * mobile/src/ui/specStripLayout.ts, so /v/{slug} and /app/v/{slug} choose the same columns at every width and both font scales.
 * All items (at most five) share one row only when every line of every cell (SpecStrip 2.0, ADR-422 d: the label.caps data
 * label, the numeral with its label.unit unit, the provenance caption), one line each, plus space.12 on both sides fits a cell;
 * else two columns (the 09 §4.2 2×2 grid, a short last row keeps its column width); else one. Above font scale 1.2 the strip
 * is at most two columns. The server cannot measure, so it takes the app's estimates (the Archivo Condensed advances of
 * GLYPH_EM plus its positive pair kerning KERNING; the Inter advances of LABEL_SEMIBOLD_EM and LABEL_MEDIUM_EM plus their
 * positive kerning bound and the roles' tracking), which decide on the app too (its measurements only take columns away).
 *
 * The page cannot run the rule per width, so `thresholds()` turns it into the narrowest strip width of each column count, and
 * `css()` into container queries on the strip box (`.sc-strip-box`, the container named sc-strip, text-body; N-R3-1: a query
 * names it, so no other size container in between can take it): em of that box, 15 px below 1280 and 16 px
 * from 1280 (tokens.generated.css --sc-type-body-size), times the QA font scale. Pure: no framework state, and the CSS it
 * builds holds only these numbers, the hashed class and fixed selectors; `style()` hands it to Blade as it is (the stack
 * sc-layout-css, printed in a nonced style element of public/layouts/base.blade.php).
 */
final class SpecStripLayout
{
    /** The side padding of a cell (space.12). */
    public const CELL_PADDING_X = 12;

    /** The vertical padding of a cell (space.16). */
    public const CELL_PADDING_Y = 16;

    /** The gap between the data label, the value line and the provenance line (space.4). */
    public const CELL_GAP = 4;

    /** The gap between a numeral and its unit (space.4). */
    public const UNIT_GAP = 4;

    /** The hairline between two cells (size.border.control on the web). */
    public const DIVIDER = 1;

    /** 09 §5: three to five items; more never share one row. */
    public const MAX_ONE_ROW = 5;

    /** Above this font scale the strip is at most two columns. */
    public const STACK_FONT_SCALE = 1.2;

    /** layout.breakpoints.desktop: the web desktop type sizes. */
    public const DESKTOP_WIDTH = 1280;

    /**
     * ADR-431 b: the numeral is hero.numeral (64/64) on the page below 1280, and hero.numeral.s (48/48 on the web desktop) in the
     * side card from 1280, as the app's specStripNumeralVariant; both capped at 1.3× the font scale.
     */
    public const NUMERAL_SIZE = 64;

    public const NUMERAL_SIZE_DESKTOP = 48;

    public const NUMERAL_MAX_SCALE = 1.3;

    /** label.caps 11/14, +4 % tracking (0.44 at 11): the data label, on every width. */
    public const CAPS_SIZE = 11;

    public const CAPS_LINE = 14;

    public const CAPS_TRACKING = 0.44;

    /** label.unit 11/14, +4 % tracking: the unit beside the numeral. */
    public const UNIT_SIZE = 11;

    public const UNIT_TRACKING = 0.44;

    /** caption 12/16, 0.1 tracking: the provenance line. */
    public const CAPTION_SIZE = 12;

    public const CAPTION_LINE = 16;

    public const CAPTION_TRACKING = 0.1;

    /** body: the strip box's own font size, which its container queries count in (15, 16 from 1280). */
    public const BODY_SIZE = 15;

    public const BODY_SIZE_DESKTOP = 16;

    /** The font scale the QA matrix asks for through :root[data-qa-font-scale="2"]. */
    public const QA_FONT_SCALE = 2;

    /**
     * SF-R2-2: Archivo Condensed 600 advance widths in em, read with fontTools from the shipped TTF
     * (mobile/assets/fonts/ArchivoCondensed-SemiBold.ttf, byte-identical to web/resources/fonts and the same advances in the
     * web woff2): advance / unitsPerEm (1000), rounded up to three decimals. Digits are the 'tnum' substitutes (zero.tf …
     * nine.tf, 472 each), which font-variant-numeric: tabular-nums draws. U+202F is not in the cmap: the browser falls back
     * to another face, so it takes the space advance like U+00A0. Negative kerning is left out and the positive pairs are added
     * (KERNING), so the estimate is never below what the screen draws. The same table as mobile/src/ui/specStripLayout.ts
     * (ADR-422 a parity, tested key by key).
     */
    public const GLYPH_EM = [
        '0' => 0.472, '1' => 0.472, '2' => 0.472, '3' => 0.472, '4' => 0.472, '5' => 0.472, '6' => 0.472, '7' => 0.472, '8' => 0.472, '9' => 0.472,
        '.' => 0.234, ',' => 0.234, "\u{2013}" => 0.375, '-' => 0.272, '/' => 0.275, '+' => 0.537, "\u{00D7}" => 0.537, ' ' => 0.151, "\u{00A0}" => 0.151, "\u{202F}" => 0.151,
        'A' => 0.548, 'B' => 0.547, 'C' => 0.572, 'D' => 0.575, 'E' => 0.52, 'F' => 0.463, 'G' => 0.613, 'H' => 0.575, 'I' => 0.241, 'J' => 0.459, 'K' => 0.561, 'L' => 0.45, 'M' => 0.712, 'N' => 0.577, 'O' => 0.616, 'P' => 0.53, 'Q' => 0.616, 'R' => 0.564, 'S' => 0.515, 'T' => 0.499, 'U' => 0.567, 'V' => 0.527, 'W' => 0.768, 'X' => 0.545, 'Y' => 0.546, 'Z' => 0.512,
        'a' => 0.457, 'b' => 0.467, 'c' => 0.438, 'd' => 0.467, 'e' => 0.454, 'f' => 0.26, 'g' => 0.45, 'h' => 0.46, 'i' => 0.213, 'j' => 0.211, 'k' => 0.44, 'l' => 0.213, 'm' => 0.69, 'n' => 0.461, 'o' => 0.468, 'p' => 0.467, 'q' => 0.467, 'r' => 0.287, 's' => 0.415, 't' => 0.259, 'u' => 0.461, 'v' => 0.405, 'w' => 0.615, 'x' => 0.434, 'y' => 0.404, 'z' => 0.404,
    ];

    /**
     * Ruling (3) of the round-3 review (ADR-425 as amended, the spec strip follows the title's principle): the positive pair
     * kerning of the same font, in em, between characters of GLYPH_EM (digits as the 'tnum' glyphs the strip draws, which have
     * none). Per ordered pair the largest XAdvance adjustment of the 'kern' feature's PairPos lookups (formats 1 and 2), kept
     * where it is above 0, / unitsPerEm, rounded up to 3 decimals; derived with fontTools 4.68 and tested against the font file
     * and against the app's table, pair by pair.
     */
    public const KERNING = [
        'A/' => 0.023, 'K/' => 0.023, 'L/' => 0.023, "f'" => 0.01, 'f)' => 0.017, 't)' => 0.002,
    ];

    /** N-R3-1: the container name of `.sc-strip-box` (public.css), the only container the strip's queries read. */
    public const CONTAINER = 'sc-strip';

    /** Every character outside GLYPH_EM: the widest letter of the table (W), so an estimate never claims a fit the screen denies. */
    public const GLYPH_FALLBACK_EM = 0.768;

    /**
     * SpecStrip 2.0: Inter SemiBold (label.caps, label.unit) advances in em, read with fontTools 4.68 from the shipped
     * mobile/assets/fonts/Inter-SemiBold.ttf (byte-identical to web/resources/fonts), advance / unitsPerEm (2048), rounded up
     * to three decimals. The same table as mobile/src/ui/specLabelMetrics.ts (tested key by key and against the font).
     */
    public const LABEL_SEMIBOLD_EM = [
        'A' => 0.728, 'B' => 0.66, 'C' => 0.737, 'D' => 0.723, 'E' => 0.606, 'F' => 0.588, 'G' => 0.75, 'H' => 0.746, 'I' => 0.277, 'J' => 0.58, 'K' => 0.704, 'L' => 0.566, 'M' => 0.923,
        'N' => 0.76, 'O' => 0.769, 'P' => 0.646, 'Q' => 0.773, 'R' => 0.653, 'S' => 0.651, 'T' => 0.661, 'U' => 0.736, 'V' => 0.728, 'W' => 1.021, 'X' => 0.72, 'Y' => 0.714, 'Z' => 0.653,
        'a' => 0.575, 'b' => 0.625, 'c' => 0.583, 'd' => 0.625, 'e' => 0.592, 'f' => 0.389, 'g' => 0.626, 'h' => 0.613, 'i' => 0.262, 'j' => 0.262, 'k' => 0.57, 'l' => 0.262, 'm' => 0.901,
        'n' => 0.612, 'o' => 0.609, 'p' => 0.625, 'q' => 0.625, 'r' => 0.397, 's' => 0.55, 't' => 0.354, 'u' => 0.613, 'v' => 0.587, 'w' => 0.84, 'x' => 0.569, 'y' => 0.589, 'z' => 0.566,
        '0' => 0.66, '1' => 0.423, '2' => 0.624, '3' => 0.637, '4' => 0.667, '5' => 0.613, '6' => 0.64, '7' => 0.577, '8' => 0.641, '9' => 0.64,
        "\u{00C4}" => 0.728, "\u{00D6}" => 0.769, "\u{00DC}" => 0.736, "\u{00E4}" => 0.575, "\u{00F6}" => 0.609, "\u{00FC}" => 0.613, "\u{00DF}" => 0.644,
        ' ' => 0.252, "\u{00A0}" => 0.252, "\u{202F}" => 0.166, '.' => 0.319, ',' => 0.319, "\u{2013}" => 0.5, '-' => 0.466, '/' => 0.379, '(' => 0.374, ')' => 0.374,
        "\u{00B3}" => 0.464, "\u{00B2}" => 0.454, "\u{00B7}" => 0.319, '&' => 0.663, "'" => 0.326, '+' => 0.673, "\u{00D7}" => 0.673, ':' => 0.319, '%' => 1.005,
    ];

    /** Inter Medium (caption) advances in em, from mobile/assets/fonts/Inter-Medium.ttf, as LABEL_SEMIBOLD_EM. */
    public const LABEL_MEDIUM_EM = [
        'A' => 0.709, 'B' => 0.657, 'C' => 0.734, 'D' => 0.722, 'E' => 0.604, 'F' => 0.59, 'G' => 0.748, 'H' => 0.745, 'I' => 0.273, 'J' => 0.576, 'K' => 0.688, 'L' => 0.566, 'M' => 0.913,
        'N' => 0.757, 'O' => 0.767, 'P' => 0.642, 'Q' => 0.769, 'R' => 0.648, 'S' => 0.646, 'T' => 0.653, 'U' => 0.741, 'V' => 0.709, 'W' => 1.003, 'X' => 0.701, 'Y' => 0.697, 'Z' => 0.641,
        'a' => 0.568, 'b' => 0.619, 'c' => 0.578, 'd' => 0.619, 'e' => 0.588, 'f' => 0.38, 'g' => 0.62, 'h' => 0.602, 'i' => 0.252, 'j' => 0.252, 'k' => 0.56, 'l' => 0.252, 'm' => 0.889,
        'n' => 0.602, 'o' => 0.605, 'p' => 0.619, 'q' => 0.619, 'r' => 0.387, 's' => 0.539, 't' => 0.341, 'u' => 0.602, 'v' => 0.575, 'w' => 0.83, 'x' => 0.558, 'y' => 0.576, 'z' => 0.56,
        '0' => 0.646, '1' => 0.416, '2' => 0.617, '3' => 0.627, '4' => 0.657, '5' => 0.604, '6' => 0.63, '7' => 0.572, '8' => 0.63, '9' => 0.63,
        "\u{00C4}" => 0.709, "\u{00D6}" => 0.767, "\u{00DC}" => 0.741, "\u{00E4}" => 0.568, "\u{00F6}" => 0.605, "\u{00FC}" => 0.602, "\u{00DF}" => 0.63,
        ' ' => 0.267, "\u{00A0}" => 0.267, "\u{202F}" => 0.174, '.' => 0.304, ',' => 0.304, "\u{2013}" => 0.5, '-' => 0.463, '/' => 0.37, '(' => 0.369, ')' => 0.369,
        "\u{00B3}" => 0.455, "\u{00B2}" => 0.448, "\u{00B7}" => 0.304, '&' => 0.654, "'" => 0.313, '+' => 0.668, "\u{00D7}" => 0.668, ':' => 0.304, '%' => 0.994,
    ];

    /** The largest positive pair kerning of Inter SemiBold among those characters, in em (47 / 2048, rounded up). */
    public const LABEL_SEMIBOLD_KERN = 0.023;

    /** The same for Inter Medium (49 / 2048, rounded up). */
    public const LABEL_MEDIUM_KERN = 0.024;

    /**
     * The column counts to try, widest first.
     *
     * @return list<int>
     */
    public static function candidates(int $count, float $fontScale): array
    {
        $oneRow = min($count, self::MAX_ONE_ROW);
        $all = $fontScale > self::STACK_FONT_SCALE ? [min($oneRow, 2), 1] : [$oneRow, 2, 1];

        return array_values(array_unique(array_filter($all, fn (int $columns): bool => $columns >= 1 && $columns <= max(1, $count))));
    }

    /** The width of one cell when the strip has `$columns` columns. */
    public static function cellWidth(float $width, int $columns, float $divider): float
    {
        return ($width - ($columns - 1) * $divider) / $columns;
    }

    /**
     * True when every content width plus the padding on both sides fits a cell of `$columns` columns.
     *
     * @param  list<float|int>  $contentWidths
     */
    public static function fits(float $width, array $contentWidths, int $columns, float $divider, float $padding = self::CELL_PADDING_X): bool
    {
        $cell = self::cellWidth($width, $columns, $divider);

        foreach ($contentWidths as $contentWidth) {
            if (ceil($contentWidth) + 2 * $padding > $cell) {
                return false;
            }
        }

        return true;
    }

    /**
     * The most columns in which everything fits; one column when nothing else does.
     *
     * @param  list<float|int>  $contentWidths
     */
    public static function columns(float $width, int $count, array $contentWidths, float $divider, float $fontScale = 1.0): int
    {
        $options = self::candidates($count, $fontScale);

        foreach ($options as $columns) {
            if (self::fits($width, $contentWidths, $columns, $divider)) {
                return $columns;
            }
        }

        return $options === [] ? 1 : $options[array_key_last($options)];
    }

    /** The advances of a value plus the positive pair kerning between each two adjacent characters. */
    public static function estimatedValueWidth(string $value, float $fontSize): float
    {
        $em = 0.0;
        $previous = null;

        foreach (mb_str_split($value) as $char) {
            $em += (self::GLYPH_EM[$char] ?? self::GLYPH_FALLBACK_EM) + ($previous === null ? 0.0 : (float) (self::KERNING[$previous.$char] ?? 0.0));
            $previous = $char;
        }

        return $em * $fontSize;
    }

    /**
     * The one-line width of a text in an Inter role: the advances, the face's positive kerning bound between each two
     * characters, and the tracking after every character (as CSS letter-spacing draws it).
     */
    public static function estimatedInterWidth(string $text, float $fontSize, float $tracking, bool $semibold): float
    {
        $table = $semibold ? self::LABEL_SEMIBOLD_EM : self::LABEL_MEDIUM_EM;
        $fallback = self::widestLetter($table);
        $chars = mb_str_split($text);

        if ($chars === []) {
            return 0.0;
        }

        $em = (count($chars) - 1) * ($semibold ? self::LABEL_SEMIBOLD_KERN : self::LABEL_MEDIUM_KERN);

        foreach ($chars as $char) {
            $em += $table[$char] ?? $fallback;
        }

        return $em * $fontSize + count($chars) * $tracking;
    }

    /**
     * The widest letter of an Inter table: every character outside it counts as that.
     *
     * @param  array<int|string, float>  $table  digit keys are integers in PHP
     */
    public static function widestLetter(array $table): float
    {
        $letters = array_filter($table, fn (string|int $char): bool => preg_match('/^\p{L}$/u', (string) $char) === 1, ARRAY_FILTER_USE_KEY);

        return $letters === [] ? 0.0 : max($letters);
    }

    /** The data label as label.caps draws it, in capitals ("ß" becomes "SS", as CSS text-transform does). */
    public static function estimatedLabelWidth(string $label, float $fontSize, float $tracking = self::CAPS_TRACKING): float
    {
        return self::estimatedInterWidth(mb_strtoupper($label, 'UTF-8'), $fontSize, $tracking, true);
    }

    /** The numeral and, beside it, the unit. */
    public static function estimatedValueLineWidth(string $value, ?string $unit, float $valueSize, float $unitSize, float $unitTracking): float
    {
        $width = self::estimatedValueWidth($value, $valueSize);

        return $unit === null || $unit === '' ? $width : $width + self::UNIT_GAP + self::estimatedInterWidth($unit, $unitSize, $unitTracking, true);
    }

    /**
     * The sizes the strip's roles render at: the numeral capped at 1.3×, the Inter roles scaled freely.
     *
     * @return array{valueSize: float, valueLine: float, labelSize: float, labelLine: float, labelTracking: float, unitSize: float, unitTracking: float, provenanceSize: float, provenanceLine: float, provenanceTracking: float}
     */
    public static function type(float $fontScale, bool $desktop): array
    {
        $numeral = $desktop ? self::NUMERAL_SIZE_DESKTOP : self::NUMERAL_SIZE;
        $numeralScale = min($fontScale, self::NUMERAL_MAX_SCALE);

        return [
            'valueSize' => $numeral * $numeralScale,
            'valueLine' => $numeral * $numeralScale,
            'labelSize' => self::CAPS_SIZE * $fontScale,
            'labelLine' => self::CAPS_LINE * $fontScale,
            'labelTracking' => self::CAPS_TRACKING * $fontScale,
            'unitSize' => self::UNIT_SIZE * $fontScale,
            'unitTracking' => self::UNIT_TRACKING * $fontScale,
            'provenanceSize' => self::CAPTION_SIZE * $fontScale,
            'provenanceLine' => self::CAPTION_LINE * $fontScale,
            'provenanceTracking' => self::CAPTION_TRACKING * $fontScale,
        ];
    }

    /**
     * The one-line estimates of every line of every cell: value line, data label, provenance (when there is one).
     *
     * @param  list<array{value: string, unit?: string|null, label: string, provenance?: string|null}>  $items
     * @return list<float>
     */
    public static function estimatedContentWidths(array $items, float $fontScale, bool $desktop): array
    {
        $type = self::type($fontScale, $desktop);
        $widths = [];

        foreach ($items as $item) {
            $widths[] = self::estimatedValueLineWidth($item['value'], $item['unit'] ?? null, $type['valueSize'], $type['unitSize'], $type['unitTracking']);
            $widths[] = self::estimatedLabelWidth($item['label'], $type['labelSize'], $type['labelTracking']);

            if (($item['provenance'] ?? null) !== null && $item['provenance'] !== '') {
                $widths[] = self::estimatedInterWidth($item['provenance'], $type['provenanceSize'], $type['provenanceTracking'], false);
            }
        }

        return $widths;
    }

    /**
     * Columns from the estimates, as the app decides before it measures.
     *
     * @param  list<array{value: string, unit?: string|null, label: string, provenance?: string|null}>  $items
     */
    public static function estimatedColumns(array $items, float $width, float $fontScale, bool $desktop, float $divider = self::DIVIDER): int
    {
        return self::columns($width, count($items), self::estimatedContentWidths($items, $fontScale, $desktop), $divider, $fontScale);
    }

    /**
     * The strip's height: per row padding, data label, gap and value line, plus gap and provenance line for a row in which
     * an item has one (`$provenance[$row]`); a hairline between rows.
     *
     * @param  list<bool>  $provenance
     */
    public static function height(int $rows, float $fontScale, bool $desktop, float $hairline, array $provenance = []): float
    {
        $type = self::type($fontScale, $desktop);
        $row = 2 * self::CELL_PADDING_Y + $type['labelLine'] + self::CELL_GAP + $type['valueLine'];
        $height = 0.0;

        for ($index = 0; $index < $rows; $index++) {
            $height += $row + (($provenance[$index] ?? false) ? self::CELL_GAP + $type['provenanceLine'] : 0);
        }

        return $height + max(0, $rows - 1) * $hairline;
    }

    /** The number of rows `$count` items take in `$columns` columns. */
    public static function rows(int $count, int $columns): int
    {
        return (int) ceil($count / max(1, $columns));
    }

    /**
     * The rule as widths: each candidate with the narrowest strip width at which it is chosen, widest first. A strip
     * narrower than every threshold takes the last candidate, which has none (null). `columns()` gives `columns` exactly
     * from `minWidth` up to the previous candidate's `minWidth`.
     *
     * @param  list<array{value: string, unit?: string|null, label: string, provenance?: string|null}>  $items
     * @return list<array{columns: int, minWidth: float|null}>
     */
    public static function thresholds(array $items, float $fontScale, bool $desktop, float $divider = self::DIVIDER): array
    {
        $widest = 0.0;

        foreach (self::estimatedContentWidths($items, $fontScale, $desktop) as $width) {
            $widest = max($widest, ceil($width));
        }

        $options = self::candidates(count($items), $fontScale);
        $last = array_key_last($options);

        return array_map(fn (int $columns, int $index): array => [
            'columns' => $columns,
            // cellWidth >= widest + 2 × padding  ⇔  width >= columns × (widest + 2 × padding) + (columns − 1) × divider
            'minWidth' => $index === $last ? null : $columns * ($widest + 2 * self::CELL_PADDING_X) + ($columns - 1) * $divider,
        ], $options, array_keys($options));
    }

    /**
     * Blade's items (value null shows "–", as the strip prints it) in the shape of the app's.
     *
     * @param  iterable<array{value?: string|null, unit?: string|null, label?: string|null, provenance?: string|null}>  $entries
     * @return list<array{value: string, unit: string|null, label: string, provenance: string|null}>
     */
    public static function items(iterable $entries): array
    {
        $items = [];

        foreach ($entries as $entry) {
            $unit = $entry['unit'] ?? null;
            $provenance = $entry['provenance'] ?? null;
            $items[] = [
                'value' => (string) ($entry['value'] ?? "\u{2013}"),
                'unit' => $unit === null || $unit === '' ? null : (string) $unit,
                'label' => (string) ($entry['label'] ?? ''),
                'provenance' => $provenance === null || $provenance === '' ? null : (string) $provenance,
            ];
        }

        return $items;
    }

    /** The strip's columns whose data label is the spec's name: the API labels them with their unit. */
    public const NAMED_KEYS = ['power', 'torque'];

    /**
     * SpecStrip 2.0 entries from the presenter's strip and spec groups, as the app's specStripItems() derives them: power and
     * torque take the spec's name as data label (`$names`, garage.spec.*), their unit beside the numeral and the source of the
     * same value in the spec tables as provenance; the other columns keep their label and have neither.
     *
     * @param  iterable<array{key: string, value: string|null, unit?: string|null, label: string}>  $strip
     * @param  iterable<array{rows?: iterable<array{key: string, source_label?: string|null}>}>  $groups
     * @param  array<string, string>  $names
     * @return list<array{key: string, value: string|null, unit: string|null, label: string, provenance: string|null}>
     */
    public static function entries(iterable $strip, iterable $groups, array $names): array
    {
        $sources = [];

        foreach ($groups as $group) {
            foreach ($group['rows'] ?? [] as $row) {
                if (($row['source_label'] ?? null) !== null && $row['source_label'] !== '') {
                    $sources[$row['key']] = (string) $row['source_label'];
                }
            }
        }

        $entries = [];

        foreach ($strip as $entry) {
            $named = in_array($entry['key'], self::NAMED_KEYS, true);
            $entries[] = [
                'key' => $entry['key'],
                'value' => $entry['value'],
                'unit' => $named ? ($entry['unit'] ?? null) : null,
                'label' => $named ? ($names[$entry['key']] ?? $entry['label']) : $entry['label'],
                'provenance' => $named && $entry['value'] !== null ? ($sources[$entry['key']] ?? null) : null,
            ];
        }

        return $entries;
    }

    /**
     * The breakpoints of one strip, in em of the strip box: per regime (scale 1 and the QA scale 2, phone/tablet and
     * desktop) the candidates and where each stops. Identical items, or items with the same breakpoints, share them.
     *
     * @param  list<array{value: string, unit?: string|null, label: string, provenance?: string|null}>  $items
     * @return array{count: int, regimes: array<string, list<array{columns: int, belowEm: float|null}>>}
     */
    public static function breakpoints(array $items): array
    {
        $regimes = [];

        foreach (['1' => 1.0, '2' => (float) self::QA_FONT_SCALE] as $scaleKey => $scale) {
            foreach (['narrow' => false, 'desktop' => true] as $mediaKey => $desktop) {
                $em = ($desktop ? self::BODY_SIZE_DESKTOP : self::BODY_SIZE) * $scale;
                $regimes[$scaleKey.'-'.$mediaKey] = array_map(fn (array $threshold): array => [
                    'columns' => $threshold['columns'],
                    'belowEm' => $threshold['minWidth'] === null ? null : self::em($threshold['minWidth'] / $em),
                ], self::thresholds($items, $scale, $desktop));
            }
        }

        return ['count' => count($items), 'regimes' => $regimes];
    }

    /**
     * @param  list<array{value: string, unit?: string|null, label: string, provenance?: string|null}>  $items
     */
    public static function className(array $items): string
    {
        return 'sc-strip--'.hash('xxh32', json_encode(self::breakpoints($items), JSON_THROW_ON_ERROR));
    }

    /**
     * The strip's columns and hairlines as CSS: one row of all items unless a container query of its regime says otherwise.
     * Scale 1 under `.{class}`, the QA scale 2 under `:root[data-qa-font-scale="2"] .{class}` (more specific, so it wins at
     * every width). Within a regime the narrower query comes later and wins.
     *
     * @param  list<array{value: string, unit?: string|null, label: string, provenance?: string|null}>  $items
     */
    public static function css(array $items, string $class): string
    {
        $breakpoints = self::breakpoints($items);
        $count = $breakpoints['count'];
        $css = '';

        foreach (['1' => '.'.$class, '2' => ':root[data-qa-font-scale="'.self::QA_FONT_SCALE.'"] .'.$class] as $scaleKey => $scope) {
            $narrow = $breakpoints['regimes'][$scaleKey.'-narrow'];
            $desktop = $breakpoints['regimes'][$scaleKey.'-desktop'];
            // The widest candidate does not depend on the width: the same on every screen.
            $css .= self::layout($scope, $narrow[0]['columns'], $count);

            // N-2: min-/max-width, since Safari 16.0–16.3 run container queries but not media range syntax. 1279.98 leaves no
            // gap at a fractional width (zoom) and never overlaps min-width: 1280px, which tokens.generated.css also uses.
            foreach (['(max-width: '.self::number(self::DESKTOP_WIDTH - 0.02).'px)' => $narrow, '(min-width: '.self::DESKTOP_WIDTH.'px)' => $desktop] as $media => $options) {
                $queries = '';

                for ($index = 1; $index < count($options); $index++) {
                    $queries .= '@container '.self::CONTAINER.' (width < '.self::number((float) $options[$index - 1]['belowEm']).'em){'.self::layout($scope, $options[$index]['columns'], $count).'}';
                }

                $css .= $queries === '' ? '' : '@media '.$media.'{'.$queries.'}';
            }
        }

        return $css;
    }

    /**
     * `css()` for a style element: trusted markup, so `{{ }}` keeps "<" and the quotes, and it can never end its element.
     *
     * @param  list<array{value: string, unit?: string|null, label: string, provenance?: string|null}>  $items
     */
    public static function style(array $items, string $class): HtmlString
    {
        return new HtmlString(str_ireplace('</style', '<\/style', self::css($items, $class)));
    }

    /**
     * One arrangement, complete: every rule has the same specificity within its scope, so the arrangement that comes last
     * sets every border and the empty slot. Hairlines between the cells of a row, above every row after the first, and on
     * the left of the empty slot of a short last row (the strip's ::after in public.css, which also draws its top line).
     */
    private static function layout(string $scope, int $columns, int $count): string
    {
        $cell = $scope.' .sc-strip-cell';
        $empty = $count > $columns && $count % $columns !== 0 ? $columns - $count % $columns : 0;

        return $scope.' .sc-strip{grid-auto-flow:row;grid-template-columns:repeat('.$columns.',minmax(0,1fr))}'
            .$cell.':nth-child(n){border-left-width:1px;border-top-width:0;padding-left:12px}'
            // ADR-431 b: no ground, so the first cell of a row starts on the text edge.
            .$cell.':nth-child('.$columns.'n+1){border-left-width:0;padding-left:0}'
            .($count > $columns ? $cell.':nth-child(n+'.($columns + 1).'){border-top-width:1px}' : '')
            .$scope.' .sc-strip::after{'.($empty > 0 ? 'display:block;grid-column:span '.$empty : 'display:none').'}';
    }

    /**
     * Up to four decimals (N-1): a breakpoint is where the strip drops to fewer columns, so rounding up never claims a fit the
     * app denies; tiny float errors do not cost a step.
     */
    private static function em(float $value): float
    {
        return ceil($value * 10000 - 1e-6) / 10000;
    }

    private static function number(float $value): string
    {
        return rtrim(rtrim(number_format($value, 4, '.', ''), '0'), '.');
    }
}
