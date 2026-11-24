<?php

namespace App\Services\Stickers;

use FontLib\Font;
use FontLib\Glyph\Outline;
use FontLib\Glyph\OutlineComposite;
use FontLib\Glyph\OutlineSimple;
use FontLib\TrueType\File as TrueType;
use RuntimeException;

/**
 * The bundled TTFs of resources/fonts as the sticker needs them: advance widths (the same numbers for the SVG, the PDF and the layout,
 * as neither dompdf nor the outlines kern), whether a font can draw a text, the cap height, and glyph outlines for the print SVG, which
 * carries text as paths so the printer needs no font. Parsed once per process.
 */
final class StickerFonts
{
    public const USERNAME = 'InterDisplay-SemiBold.ttf';

    public const CAR_NAME = 'ArchivoSemiExpanded-SemiBold.ttf';

    public const LINE = 'Inter-Medium.ttf';

    public const SLUG = 'Inter-Regular.ttf';

    /** @var array<string, array{font: TrueType, map: array<int, int>, advances: array<int, array{0: int, 1: int}>, upm: int, cap: float}> */
    private static array $fonts = [];

    /** @var array<string, string> font|glyph => SVG path in font units, y up */
    private static array $outlines = [];

    public static function path(string $file): string
    {
        return resource_path('fonts/'.$file);
    }

    /**
     * The advance width of $text at an em size of 1.
     */
    public static function width(string $file, string $text): float
    {
        $font = self::font($file);
        $units = 0;

        foreach (mb_str_split($text) as $character) {
            $units += $font['advances'][$font['map'][mb_ord($character)] ?? 0][0] ?? 0;
        }

        return $units / $font['upm'];
    }

    /**
     * Whether every character of $text has a glyph (spaces included).
     */
    public static function covers(string $file, string $text): bool
    {
        $map = self::font($file)['map'];

        foreach (mb_str_split($text) as $character) {
            if (! isset($map[mb_ord($character)])) {
                return false;
            }
        }

        return true;
    }

    /**
     * Height of a capital H at an em size of 1.
     */
    public static function capHeight(string $file): float
    {
        return self::font($file)['cap'];
    }

    /**
     * The glyphs of $text as one SVG path, at $size (mm per em), left end of the baseline at ($x, $baseline), y down.
     */
    public static function svgPath(string $file, string $text, float $size, float $x, float $baseline): string
    {
        $font = self::font($file);
        $scale = $size / $font['upm'];
        $path = '';
        $pen = 0;

        foreach (mb_str_split($text) as $character) {
            $glyph = $font['map'][mb_ord($character)] ?? 0;
            $contours = self::outline($file, $glyph);

            if ($contours !== '') {
                $path .= self::place($contours, $x + $pen * $scale, $baseline, $scale);
            }

            $pen += $font['advances'][$glyph][0] ?? 0;
        }

        return $path;
    }

    /**
     * Font-unit contours (y up) moved to the page (y down) and scaled: every number of M/L/Q is an x,y pair.
     */
    private static function place(string $contours, float $x, float $baseline, float $scale): string
    {
        return (string) preg_replace_callback('/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/', fn (array $m): string => self::number($x + (float) $m[1] * $scale).','.self::number($baseline - (float) $m[2] * $scale), $contours);
    }

    private static function number(float $value): string
    {
        $text = rtrim(rtrim(number_format($value, 3, '.', ''), '0'), '.');

        return $text === '-0' ? '0' : $text;
    }

    private static function outline(string $file, int $glyph): string
    {
        $key = $file.'|'.$glyph;

        if (isset(self::$outlines[$key])) {
            return self::$outlines[$key];
        }

        /** @var array<int, Outline> $glyphs */
        $glyphs = self::font($file)['font']->getTableObject('glyf')->data;

        return self::$outlines[$key] = isset($glyphs[$glyph]) ? self::contours($glyphs, $glyphs[$glyph], [1, 0, 0, 1, 0, 0]) : '';
    }

    /**
     * Simple glyphs give their contours; a composite (an umlaut: base + dieresis) gives its components, each through its matrix.
     *
     * @param  array<int, Outline>  $glyphs
     * @param  array{0: float|int, 1: float|int, 2: float|int, 3: float|int, 4: float|int, 5: float|int}  $matrix  a b c d e f
     */
    private static function contours(array $glyphs, Outline $outline, array $matrix): string
    {
        // An empty glyph (the space) is a simple one without points: no contours.
        $outline->parseData();

        if ($outline instanceof OutlineSimple) {
            $path = trim((string) $outline->getSVGContours());

            return $matrix === [1, 0, 0, 1, 0, 0] ? $path : (string) preg_replace_callback('/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/', function (array $m) use ($matrix): string {
                $x = (float) $m[1];
                $y = (float) $m[2];

                return ($matrix[0] * $x + $matrix[2] * $y + $matrix[4]).','.($matrix[1] * $x + $matrix[3] * $y + $matrix[5]);
            }, $path);
        }

        if (! $outline instanceof OutlineComposite) {
            return '';
        }

        $path = '';

        foreach ($outline->components as $component) {
            $child = $glyphs[$component->glyphIndex] ?? null;

            if ($child === null || $child === $outline) {
                continue;
            }

            [$a, $b, $c, $d, $e, $f] = $component->getMatrix();
            // The parent's matrix after the component's.
            $combined = [
                $matrix[0] * $a + $matrix[2] * $b, $matrix[1] * $a + $matrix[3] * $b,
                $matrix[0] * $c + $matrix[2] * $d, $matrix[1] * $c + $matrix[3] * $d,
                $matrix[0] * $e + $matrix[2] * $f + $matrix[4], $matrix[1] * $e + $matrix[3] * $f + $matrix[5],
            ];
            $path .= ' '.self::contours($glyphs, $child, $combined);
        }

        return trim($path);
    }

    /**
     * @return array{font: TrueType, map: array<int, int>, advances: array<int, array{0: int, 1: int}>, upm: int, cap: float}
     */
    private static function font(string $file): array
    {
        if (isset(self::$fonts[$file])) {
            return self::$fonts[$file];
        }

        $font = Font::load(self::path($file));

        if (! $font instanceof TrueType) {
            throw new RuntimeException("The sticker font [$file] cannot be read.");
        }

        $font->parse();
        /** @var array<int, int> $map */
        $map = $font->getUnicodeCharMap();
        /** @var array<int, array{0: int, 1: int}> $advances */
        $advances = $font->getData('hmtx');
        /** @var int $upm */
        $upm = $font->getData('head', 'unitsPerEm');
        /** @var array<int, Outline> $glyphs */
        $glyphs = $font->getTableObject('glyf')->data;
        $h = $glyphs[$map[ord('H')] ?? 0] ?? null;
        $h?->parseData();
        $cap = $h === null ? 0.7 : max(0.5, $h->yMax / $upm);

        return self::$fonts[$file] = ['font' => $font, 'map' => $map, 'advances' => $advances, 'upm' => $upm, 'cap' => $cap];
    }
}
