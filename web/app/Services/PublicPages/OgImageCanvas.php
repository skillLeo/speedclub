<?php

namespace App\Services\PublicPages;

use App\Support\DesignTokens;
use GdImage;
use Normalizer;
use RuntimeException;

/**
 * Draws the link previews of the public pages with GD, which is all shared hosting promises (ADR-005): 1200 × 630 for og:image and
 * a 1080 × 1080 square beside it. Night editorial (09 §4): the photo edge to edge on one side, a solid canvas panel on the other (no
 * gradient, no glow), the car's name in Archivo SemiExpanded, the numerals in Archivo Condensed, people and labels in Inter, the
 * client's white brush wordmark as delivered as the only brand mark, red only as one short brake-light rule. Colours come from the
 * generated tokens (DesignTokens), fonts from resources/fonts, never from the host.
 *
 * A JPEG without metadata (GD writes none), sRGB as the sources are (MediaService re-encodes every upload), below MAX_BYTES.
 */
class OgImageCanvas
{
    public const WIDTH = 1200;

    public const HEIGHT = 630;

    public const LANDSCAPE = 'landscape';

    public const SQUARE = 'square';

    /** @var array<string, array{int<1, max>, int<1, max>}> width and height per format */
    public const FORMATS = [self::LANDSCAPE => [1200, 630], self::SQUARE => [1080, 1080]];

    /** What a preview may weigh: WhatsApp drops images above 300 KB, so a margin stays. */
    public const MAX_BYTES = 290_000;

    /** Tried in turn until the file is small enough. */
    private const QUALITIES = [86, 80, 74, 68, 60, 52];

    /** Landscape: the photo's share of the width; the panel takes the rest. */
    private const PHOTO_WIDTH = 700;

    /** Square: the photo's share of the height. */
    private const PHOTO_HEIGHT = 540;

    /** display.title (09 §4.2): cars speak Archivo SemiExpanded, the make above the name as its wordmark. */
    private const FONT_DISPLAY = 'ArchivoSemiExpanded-SemiBold.ttf';

    /** title.1: people speak Inter, a member's name in its display cut. */
    private const FONT_NAME = 'InterDisplay-SemiBold.ttf';

    /** The spec numerals: Archivo Condensed, as the SpecStrip. */
    private const FONT_NUMERALS = 'ArchivoCondensed-SemiBold.ttf';

    private const FONT_TEXT = 'Inter-Medium.ttf';

    /** label.caps and label.unit. */
    private const FONT_LABEL = 'Inter-SemiBold.ttf';

    /** The wordmark as delivered, and the box its ink fills (measured once from the file, at 1280 × 383). */
    private const LOGO = 'brand/logo-wide-white-1280.png';

    private const LOGO_INK = [38, 38, 1203, 307];

    /**
     * What both Archivo files hold of INTER_RANGES: Latin with Latin Extended-A, much of B, Vietnamese, U+1E9E and typographic
     * punctuation; of Greek only Δ Ω µ π, no Cyrillic. GD has no call to ask a font, and comparing boxes cannot tell a letter from a
     * font's own "NO GLYPH" box. OgImageTextTest checks this against the files.
     *
     * @var list<array{int, int}>
     */
    public const ARCHIVO_RANGES = [
        [0x20, 0x7E], [0xA0, 0xAC], [0xAE, 0x148], [0x14A, 0x17F], [0x18F, 0x18F], [0x192, 0x192], [0x19D, 0x19D], [0x1A0, 0x1A1],
        [0x1AF, 0x1B0], [0x1C5, 0x1DC], [0x1E6, 0x1E7], [0x1EA, 0x1EB], [0x1FA, 0x21B], [0x22A, 0x22D], [0x230, 0x233], [0x237, 0x237],
        [0x394, 0x394], [0x3A9, 0x3A9], [0x3BC, 0x3BC], [0x3C0, 0x3C0], [0x1E24, 0x1E25], [0x1E62, 0x1E63], [0x1E6C, 0x1E6D],
        [0x1E80, 0x1E85], [0x1E9E, 0x1E9E], [0x1EA0, 0x1EF9], [0x2010, 0x2011], [0x2013, 0x2015], [0x2017, 0x201A], [0x201C, 0x201E],
        [0x2020, 0x2022], [0x2026, 0x2026], [0x2030, 0x2030], [0x2032, 0x2033], [0x2039, 0x203A], [0x203E, 0x203E], [0x2044, 0x2044],
        [0x2052, 0x2052], [0x20AC, 0x20AC], [0x2122, 0x2122],
    ];

    /**
     * What every Inter file here (Inter and Inter Display) holds of what people type: Latin with its extensions, Greek, Cyrillic and
     * typographic punctuation. Archivo's list lies within this one, so this is all a card can draw.
     * Nothing above U+FFFF, no variation selector and no joiner: GD reads a four-byte character byte by byte. Arabic, Hebrew and CJK
     * stay out, as the fonts have none and GD cannot shape them.
     *
     * @var list<array{int, int}>
     */
    public const INTER_RANGES = [
        [0x20, 0x7E], [0xA0, 0xAC], [0xAE, 0x148], [0x14A, 0x1C3], [0x1C5, 0x24F], [0x384, 0x38A], [0x38C, 0x38C], [0x38E, 0x3A1],
        [0x3A3, 0x3D7], [0x400, 0x479], [0x48A, 0x49D], [0x4A0, 0x4FF], [0x1E00, 0x1E9B], [0x1E9E, 0x1E9E], [0x1EA0, 0x1EF9],
        [0x2010, 0x2027], [0x2030, 0x2055], [0x20AC, 0x20AC], [0x2122, 0x2122],
    ];

    /**
     * A vehicle: its cover photo by the focal point, the make as the eyebrow, the name, up to three specs, the owner's handle and the
     * code of its sticker.
     *
     * @param  string  $photo  image bytes
     * @param  float|null  $focalX  0 to 1, null for the centre
     * @param  float|null  $focalY  0 to 1, null for the centre
     * @param  list<array{value: string, unit: string|null, label: string}>  $specs  at most three are drawn
     * @param  string|null  $handle  "@lukas.sc", null when the owner is not named on the page
     * @param  string|null  $qr  PNG of the code, square, white with its quiet zone
     */
    public function vehicle(string $photo, ?float $focalX, ?float $focalY, ?string $eyebrow, string $title, array $specs = [], ?string $handle = null, ?string $qr = null, string $format = self::LANDSCAPE): string
    {
        $eyebrow = $this->sanitise((string) $eyebrow);
        $title = $this->sanitise($title);
        $handle = $this->sanitise((string) $handle);
        $specs = $this->drawableSpecs($specs);

        [$image, $panel] = $this->split($format, $photo, $focalX, $focalY);
        $square = $format === self::SQUARE;
        $cursor = $this->brandRow($image, $panel, $square ? $handle : '', $square ? 180 : 168);
        $qrSize = $qr === null ? 0 : ($square ? 152 : 112);

        if ($eyebrow !== '') {
            $cursor = $this->line($image, self::FONT_DISPLAY, $eyebrow, $square ? 24 : 20, $square ? 18 : 16, $panel['x'], $cursor, $panel['width'], 'text-secondary') + ($square ? 16 : 14);
        }

        if ($title !== '') {
            $this->title($image, self::FONT_DISPLAY, $title, $square ? 60 : 44, $square ? 40 : 30, $panel['x'], $cursor, $panel['width']);
        }

        $specsWidth = $panel['width'] - ($qrSize === 0 ? 0 : $qrSize + 32);

        if ($specs !== []) {
            $this->specs($image, $specs, $panel['x'], $square ? 884 : 336, $square ? $specsWidth : $panel['width'], $square ? 56 : 48);
        }

        if ($qr !== null) {
            $this->qr($image, $qr, $panel['right'] - $qrSize, $panel['bottom'] - $qrSize, $qrSize);
        }

        if (! $square && $handle !== '') {
            $this->text($image, self::FONT_TEXT, $handle, 22, 18, $panel['x'], $panel['bottom'], $panel['width'] - ($qrSize === 0 ? 0 : $qrSize + 24), 'text-secondary');
        }

        return $this->encode($image);
    }

    /**
     * A member: the cover (else the avatar) as the photo, the avatar round beside the name, handle and city, the number of public builds.
     * Without any photo the whole card is the canvas.
     *
     * @param  string|null  $cover  image bytes
     * @param  string|null  $avatar  image bytes
     * @param  int|null  $builds  public builds, null or 0 draws no figure
     */
    public function member(?string $cover, ?float $focalX, ?float $focalY, ?string $avatar, string $name, string $handle, ?string $city, ?int $builds = null, string $format = self::LANDSCAPE): string
    {
        $name = $this->sanitise($name);
        $city = $this->sanitise((string) $city);
        $square = $format === self::SQUARE;
        $photo = $cover ?? $avatar;

        [$image, $panel] = $this->split($format, $photo, $cover === null ? null : $focalX, $cover === null ? null : $focalY);
        $cursor = $this->brandRow($image, $panel, '', $square ? 180 : 168);

        $x = $panel['x'];
        $width = $panel['width'];
        $avatarBottom = $cursor;

        // The round avatar only beside a cover: alone, it is the photo already. Above the name in the narrow panel, left of it in the square.
        if ($cover !== null && $avatar !== null) {
            $size = $square ? 120 : 96;
            $this->avatar($image, $avatar, $x, $cursor, $size);
            $avatarBottom = $cursor + $size;

            if ($square) {
                $x += $size + 28;
                $width -= $size + 28;
            } else {
                $cursor += $size + 24;
            }
        }

        if ($name !== '') {
            $cursor = $this->title($image, self::FONT_NAME, $name, $square ? 56 : 44, $square ? 36 : 30, $x, $cursor, $width) + 8;
        }

        $line = $handle.($city === '' ? '' : ' · '.$city);
        $cursor = max($avatarBottom, $this->line($image, self::FONT_TEXT, $line, $square ? 26 : 22, 18, $x, $cursor, $width, 'text-secondary'));

        if ($builds !== null && $builds > 0) {
            $this->specs($image, [['value' => (string) $builds, 'unit' => $builds === 1 ? 'Build' : 'Builds', 'label' => 'Garage']], $panel['x'], max($square ? 884 : 420, $cursor + 32), $panel['width'], $square ? 56 : 48);
        }

        return $this->encode($image);
    }

    /**
     * The brand card for the landing page and every page without a picture of its own: a night photo of the brand layer, the wordmark
     * large, one line.
     *
     * @param  string  $photo  image bytes
     */
    public function site(string $photo, ?float $focalX, ?float $focalY, string $line, string $format = self::LANDSCAPE): string
    {
        $square = $format === self::SQUARE;
        [$image, $panel] = $this->split($format, $photo, $focalX, $focalY);

        $width = min($panel['width'], $square ? 520 : 400);
        // The wordmark and the line as one block, about the optical centre of the panel.
        $top = $panel['y'] + ($square ? 84 : 132);
        $height = $this->logo($image, $panel['x'], $top, $width);
        $cursor = $top + $height + ($square ? 40 : 36);
        $this->accent($image, $panel['x'], $cursor);
        $this->title($image, self::FONT_DISPLAY, $this->sanitise($line), $square ? 44 : 34, 26, $panel['x'], $cursor + 28, $panel['width']);

        return $this->encode($image);
    }

    /** Brackets, quotes aside: a pair with nothing left inside it is dropped. */
    private const EMPTY_PAIR = '/\(\s*\)|\[\s*\]|\{\s*\}/u';

    /** What only stands between words. Standing alone beside another one or at an edge, it separated something that is gone. */
    private const SEPARATOR = '[\-–—·•|\/,:;+&]';

    /**
     * What is left of a text once everything a card cannot draw is gone, also for the callers, who decide what stands in for an
     * empty result: a member's name becomes the handle, a vehicle's line is skipped. Without a single letter or digit nothing is
     * left: '(محمد)' would draw as '()' and '🏎 - 🏁' as '-'.
     */
    public function sanitise(string $text): string
    {
        $text = mb_scrub($text, 'UTF-8');

        // A decomposed umlaut (macOS file names, some keyboards) is two code points, and the fonts have the one it joins up to.
        if (class_exists(Normalizer::class)) {
            $text = Normalizer::normalize($text, Normalizer::FORM_C) ?: $text;
        }

        // Before the filter: a thin space is not in the fonts, and the words beside it must not run together.
        $text = (string) preg_replace('/\s+/u', ' ', $text);
        $drawable = '';

        foreach (mb_str_split($text) as $character) {
            if ($this->covers(self::INTER_RANGES, $character)) {
                $drawable .= $character;
            }
        }

        $drawable = $this->tidy($drawable);

        return preg_match('/[\p{L}\p{N}]/u', $drawable) === 1 ? $drawable : '';
    }

    /**
     * Cleans up after the filter: 'Ali (محمد)' leaves 'Ali ()', 'Ali 🏎 - 🏁 - Khan' leaves 'Ali - - Khan'. Only what stands alone
     * between spaces counts as a separator, so 'GT-R' keeps its hyphen.
     */
    private function tidy(string $text): string
    {
        do {
            $before = $text;
            $text = (string) preg_replace(self::EMPTY_PAIR, '', $text);
        } while ($text !== $before);

        $text = trim((string) preg_replace('/ +/', ' ', $text));
        $separator = self::SEPARATOR;
        $text = (string) preg_replace("/(?<=^| )({$separator})(?: {$separator})+(?= |$)/u", '$1', $text);

        return trim((string) preg_replace("/^(?:{$separator}(?: |$))+|(?:(?:^| ){$separator})+$/u", '', $text));
    }

    /**
     * @param  list<array{int, int}>  $ranges
     */
    private function covers(array $ranges, string $character): bool
    {
        $codePoint = mb_ord($character);

        foreach ($ranges as [$from, $to]) {
            if ($codePoint >= $from && $codePoint <= $to) {
                return true;
            }
        }

        return false;
    }

    /**
     * A line stays in one font: the design's, or Inter when Archivo lacks a letter of it, which keeps a Cyrillic or Greek name readable.
     * Inter Display holds all of INTER_RANGES, so a member's name never changes font.
     */
    private function fontFor(string $font, string $text): string
    {
        if ($font !== self::FONT_DISPLAY && $font !== self::FONT_NUMERALS) {
            return $font;
        }

        foreach (mb_str_split($text) as $character) {
            if (! $this->covers(self::ARCHIVO_RANGES, $character)) {
                return self::FONT_TEXT;
            }
        }

        return $font;
    }

    /**
     * @param  list<array{value: string, unit: string|null, label: string}>  $specs
     * @return list<array{value: string, unit: string, label: string}>
     */
    private function drawableSpecs(array $specs): array
    {
        $drawable = [];

        foreach ($specs as $spec) {
            $value = $this->sanitise($spec['value']);

            if ($value !== '' && count($drawable) < 3) {
                $drawable[] = ['value' => $value, 'unit' => $this->sanitise((string) $spec['unit']), 'label' => $this->sanitise($spec['label'])];
            }
        }

        return $drawable;
    }

    /**
     * The canvas with the photo in its place and the panel's text box. Landscape: photo left, panel right. Square: photo on top, panel
     * below. Without a photo the panel is the whole card.
     *
     * @return array{GdImage, array{x: int, y: int, width: int, right: int, bottom: int}}
     */
    private function split(string $format, ?string $photo, ?float $focalX, ?float $focalY): array
    {
        [$width, $height] = self::FORMATS[$format] ?? throw new RuntimeException("Unknown OG format [$format].");
        $image = imagecreatetruecolor($width, $height);

        if (! $image instanceof GdImage) {
            throw new RuntimeException('GD could not create the OG canvas.');
        }

        imagealphablending($image, true);
        imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, $this->color($image, 'bg-canvas'));
        $square = $format === self::SQUARE;
        $margin = $square ? 56 : 48;

        if ($photo === null) {
            $margin = $square ? 72 : 64;

            return [$image, ['x' => $margin, 'y' => $margin, 'width' => $width - 2 * $margin, 'right' => $width - $margin, 'bottom' => $height - $margin]];
        }

        if ($square) {
            $this->cover($image, $photo, $focalX, $focalY, 0, 0, $width, self::PHOTO_HEIGHT);

            return [$image, ['x' => $margin, 'y' => self::PHOTO_HEIGHT + 48, 'width' => $width - 2 * $margin, 'right' => $width - $margin, 'bottom' => $height - $margin]];
        }

        $this->cover($image, $photo, $focalX, $focalY, 0, 0, self::PHOTO_WIDTH, $height);
        $x = self::PHOTO_WIDTH + $margin;

        return [$image, ['x' => $x, 'y' => $margin, 'width' => $width - $margin - $x, 'right' => $width - $margin, 'bottom' => $height - $margin]];
    }

    /**
     * The wordmark at the top of the panel, a text right-aligned beside it, then the brake-light rule. Returns where the text below starts.
     *
     * @param  array{x: int, y: int, width: int, right: int, bottom: int}  $panel
     */
    private function brandRow(GdImage $image, array $panel, string $beside, int $logoWidth): int
    {
        $height = $this->logo($image, $panel['x'], $panel['y'], $logoWidth);

        if ($beside !== '') {
            $path = $this->font(self::FONT_TEXT, $beside);
            $size = 26;
            $room = $panel['width'] - $logoWidth - 32;

            while ($size > 18 && $this->width($path, $size, $beside) > $room) {
                $size -= 2;
            }

            $text = $this->fit($path, $size, $beside, $room);
            $x = $panel['right'] - $this->width($path, $size, $text);
            imagettftext($image, $size, 0, $x, $panel['y'] + (int) round(($height + $size * 0.72) / 2), $this->color($image, 'text-secondary'), $path, $this->literal($text));
        }

        $rule = $panel['y'] + $height + 32;
        $this->accent($image, $panel['x'], $rule);

        return $rule + 4 + 24;
    }

    /**
     * One short rule in the accent fill: the card's only red, far below 5 % of it.
     */
    private function accent(GdImage $image, int $x, int $y): void
    {
        imagefilledrectangle($image, $x, $y, $x + 31, $y + 3, $this->color($image, 'accent-fill'));
    }

    /**
     * A single line whose top lies at $top. Returns the baseline.
     */
    private function line(GdImage $image, string $font, string $text, int $size, int $minSize, int $x, int $top, int $maxWidth, string $color = 'text-primary'): int
    {
        if ($text === '') {
            return $top;
        }

        $baseline = $top + (int) round($size * 0.76);
        $this->text($image, $font, $text, $size, $minSize, $x, $baseline, $maxWidth, $color);

        return $baseline + (int) round($size * 0.24);
    }

    /**
     * A name in up to two balanced lines: as large as it fits on one line, else the size at which two lines fit with the break that
     * keeps them closest in width (a model code stays with the word before it), else two lines at the smallest size, the second ending
     * in an ellipsis. Returns the bottom of the last line.
     */
    private function title(GdImage $image, string $font, string $text, int $size, int $minSize, int $x, int $top, int $maxWidth): int
    {
        if ($text === '') {
            return $top;
        }

        $path = $this->font($font, $text);
        $lines = [$text];
        $chosen = $minSize;

        for ($candidate = $size; $candidate >= $minSize; $candidate -= 2) {
            if ($this->width($path, $candidate, $text) <= $maxWidth) {
                $lines = [$text];
                $chosen = $candidate;

                break;
            }

            $split = $this->balanced($path, $candidate, $text, $maxWidth);

            if ($split !== null) {
                $lines = $split;
                $chosen = $candidate;

                break;
            }

            $chosen = $candidate;
            $lines = $this->greedy($path, $candidate, $text, $maxWidth);
        }

        $lineHeight = (int) round($chosen * 1.12);
        $baseline = $top + (int) round($chosen * 0.76);
        $color = $this->color($image, 'text-primary');

        foreach (array_slice($lines, 0, 2) as $line) {
            imagettftext($image, $chosen, 0, $x, $baseline, $color, $path, $this->literal($this->fit($path, $chosen, $line, $maxWidth)));
            $baseline += $lineHeight;
        }

        return $baseline - $lineHeight + (int) round($chosen * 0.24);
    }

    /**
     * @return list<string>|null two lines that both fit, null when no break does
     */
    private function balanced(string $path, int $size, string $text, int $maxWidth): ?array
    {
        $words = explode(' ', $text);
        $best = null;
        $bestWidth = PHP_INT_MAX;

        for ($break = 1; $break < count($words); $break++) {
            $first = implode(' ', array_slice($words, 0, $break));
            $second = implode(' ', array_slice($words, $break));
            $widest = max($this->width($path, $size, $first), $this->width($path, $size, $second));

            if ($widest <= $maxWidth && $widest < $bestWidth) {
                $best = [$first, $second];
                $bestWidth = $widest;
            }
        }

        return $best;
    }

    /**
     * As many words as fit on the first line, the rest on the second (fit() ends it in an ellipsis).
     *
     * @return list<string>
     */
    private function greedy(string $path, int $size, string $text, int $maxWidth): array
    {
        $words = explode(' ', $text);
        $first = array_shift($words);

        while ($words !== [] && $this->width($path, $size, $first.' '.$words[0]) <= $maxWidth) {
            $first .= ' '.array_shift($words);
        }

        return $words === [] ? [$first] : [$first, implode(' ', $words)];
    }

    /**
     * Up to three columns: the data label in caps, the numeral in Archivo Condensed, the unit beside it. A hairline above.
     *
     * @param  list<array{value: string, unit: string, label: string}>  $specs
     */
    private function specs(GdImage $image, array $specs, int $x, int $top, int $width, int $size): void
    {
        imageline($image, $x, $top, $x + $width, $top, $this->color($image, 'border-hairline'));

        $column = (int) floor($width / 3);
        $labelBaseline = $top + 40;
        $valueBaseline = $labelBaseline + 16 + $size;
        $label = resource_path('fonts/'.self::FONT_LABEL);

        foreach ($specs as $index => $spec) {
            $left = $x + $index * $column;
            $room = $column - 16;
            $caps = mb_strtoupper($spec['label']);
            $labelSize = $size >= 56 ? 13 : 12;

            while ($labelSize > 10 && $this->width($label, $labelSize, $caps) > $column - 12) {
                $labelSize--;
            }

            imagettftext($image, $labelSize, 0, $left, $labelBaseline, $this->color($image, 'text-tertiary'), $label, $this->literal($this->fit($label, $labelSize, $caps, $column - 12)));

            $numeral = $this->font(self::FONT_NUMERALS, $spec['value']);
            $unitWidth = $spec['unit'] === '' ? 0 : $this->width($label, 16, $spec['unit']) + 6;
            $valueSize = $size;

            while ($valueSize > 28 && $this->width($numeral, $valueSize, $spec['value']) + $unitWidth > $room) {
                $valueSize -= 2;
            }

            $value = $this->fit($numeral, $valueSize, $spec['value'], $room - $unitWidth);
            imagettftext($image, $valueSize, 0, $left, $valueBaseline, $this->color($image, 'text-primary'), $numeral, $this->literal($value));

            if ($spec['unit'] !== '') {
                imagettftext($image, 16, 0, $left + $this->width($numeral, $valueSize, $value) + 6, $valueBaseline, $this->color($image, 'text-secondary'), $label, $this->literal($spec['unit']));
            }
        }
    }

    /**
     * Fills the box and keeps the focal point inside the crop, as the page does with object-position (03_DESIGN_SYSTEM §7).
     */
    private function cover(GdImage $image, string $bytes, ?float $focalX, ?float $focalY, int $x, int $y, int $width, int $height): void
    {
        $source = $this->load($bytes);
        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $scale = max($width / $sourceWidth, $height / $sourceHeight);
        $cropWidth = min($sourceWidth, (int) round($width / $scale));
        $cropHeight = min($sourceHeight, (int) round($height / $scale));

        $left = (int) round(($sourceWidth * ($focalX ?? 0.5)) - ($cropWidth / 2));
        $top = (int) round(($sourceHeight * ($focalY ?? 0.5)) - ($cropHeight / 2));

        imagecopyresampled(
            $image,
            $source,
            $x,
            $y,
            max(0, min($left, $sourceWidth - $cropWidth)),
            max(0, min($top, $sourceHeight - $cropHeight)),
            $width,
            $height,
            $cropWidth,
            $cropHeight,
        );
    }

    /**
     * The delivered wordmark, its ink box scaled to $width. Returns the drawn height.
     */
    private function logo(GdImage $image, int $x, int $y, int $width): int
    {
        $logo = @imagecreatefrompng(public_path(self::LOGO));

        if (! $logo instanceof GdImage) {
            throw new RuntimeException('GD could not read the wordmark.');
        }

        [$left, $top, $inkWidth, $inkHeight] = self::LOGO_INK;
        $height = (int) round($inkHeight * $width / $inkWidth);
        imagecopyresampled($image, $logo, $x, $y, $left, $top, $width, $height, $inkWidth, $inkHeight);

        return $height;
    }

    /**
     * The code at its own size (its quiet zone is white already), never scaled: a resampled module turns grey.
     */
    private function qr(GdImage $image, string $png, int $x, int $y, int $size): void
    {
        $code = @imagecreatefromstring($png);

        if (! $code instanceof GdImage) {
            throw new RuntimeException('GD could not read the QR code.');
        }

        imagefilledrectangle($image, $x, $y, $x + $size - 1, $y + $size - 1, $this->color($image, 'qr-bg'));
        $side = min($size, imagesx($code), imagesy($code));
        imagecopy($image, $code, $x + intdiv($size - $side, 2), $y + intdiv($size - $side, 2), 0, 0, $side, $side);
    }

    /**
     * Round, drawn at twice the size and scaled down, so the edge is smooth.
     */
    private function avatar(GdImage $image, string $bytes, int $x, int $y, int $size): void
    {
        $source = $this->load($bytes);
        $side = min(imagesx($source), imagesy($source));
        $double = max(2, $size * 2);
        $round = imagecreatetruecolor($double, $double);

        if (! $round instanceof GdImage) {
            throw new RuntimeException('GD could not create the avatar.');
        }

        imagealphablending($round, false);
        imagesavealpha($round, true);
        imagecopyresampled($round, $source, 0, 0, intdiv(imagesx($source) - $side, 2), intdiv(imagesy($source) - $side, 2), $double, $double, $side, $side);
        $clear = (int) imagecolorallocatealpha($round, 0, 0, 0, 127);
        $radius = $double / 2;

        for ($row = 0; $row < $double; $row++) {
            for ($column = 0; $column < $double; $column++) {
                if ((($column - $radius + 0.5) ** 2) + (($row - $radius + 0.5) ** 2) > $radius ** 2) {
                    imagesetpixel($round, $column, $row, $clear);
                }
            }
        }

        imagecopyresampled($image, $round, $x, $y, 0, 0, $size, $size, $double, $double);
    }

    private function load(string $bytes): GdImage
    {
        $source = @imagecreatefromstring($bytes);

        return $source instanceof GdImage ? $source : throw new RuntimeException('GD could not read the OG source image.');
    }

    /**
     * Shrinks to $minSize first; a text that is still too long ends in an ellipsis.
     */
    private function text(GdImage $image, string $font, string $text, int $size, int $minSize, int $x, int $baseline, int $maxWidth, string $color = 'text-primary'): void
    {
        $path = $this->font($font, $text);

        while ($size > $minSize && $this->width($path, $size, $text) > $maxWidth) {
            $size -= 2;
        }

        imagettftext($image, $size, 0, $x, $baseline, $this->color($image, $color), $path, $this->literal($this->fit($path, $size, $text, $maxWidth)));
    }

    private function fit(string $path, int $size, string $text, int $maxWidth): string
    {
        if ($this->width($path, $size, $text) <= $maxWidth) {
            return $text;
        }

        while (mb_strlen($text) > 1 && $this->width($path, $size, $text.'…') > $maxWidth) {
            $text = mb_substr($text, 0, -1);
        }

        return rtrim($text).'…';
    }

    private function font(string $font, string $text): string
    {
        return resource_path('fonts/'.$this->fontFor($font, $text));
    }

    private function width(string $font, int $size, string $text): int
    {
        $box = imagettfbbox($size, 0, $font, $this->literal($text));

        return $box === false ? 0 : abs($box[2] - $box[0]);
    }

    /**
     * GD reads '&#1488;', '&hearts;' and '&amp;' as the character they name, after sanitise() has looked: a box, or what the member did
     * not type. Its own escape for the ampersand keeps every one of them as typed, as the page shows it.
     */
    private function literal(string $text): string
    {
        return str_replace('&', '&#38;', $text);
    }

    private function color(GdImage $image, string $token): int
    {
        [$red, $green, $blue, $alpha] = DesignTokens::rgba($token);

        return (int) imagecolorallocatealpha($image, $red, $green, $blue, max(0, min(127, 127 - (int) round($alpha * 127))));
    }

    /**
     * The best quality that stays below MAX_BYTES, progressive.
     */
    private function encode(GdImage $image): string
    {
        imageinterlace($image, true);
        $bytes = '';

        foreach (self::QUALITIES as $quality) {
            ob_start();
            imagejpeg($image, null, $quality);
            $bytes = (string) ob_get_clean();

            if (strlen($bytes) <= self::MAX_BYTES) {
                break;
            }
        }

        return $bytes;
    }
}
