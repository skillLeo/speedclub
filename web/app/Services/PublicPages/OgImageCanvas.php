<?php

namespace App\Services\PublicPages;

use GdImage;
use Normalizer;
use RuntimeException;

/**
 * Draws the 1200 × 630 JPEG of a public page with GD, which is all shared hosting promises (ADR-005). Brand layer (03_DESIGN_SYSTEM §2):
 * photo, scrim for legibility, the client's wordmark as delivered, never redrawn. Fonts come from resources/fonts, not from the host.
 */
class OgImageCanvas
{
    public const WIDTH = 1200;

    public const HEIGHT = 630;

    private const MARGIN = 64;

    private const QUALITY = 85;

    private const AVATAR_SIZE = 200;

    private const FONT_DISPLAY = 'BarlowSemiCondensed-Bold.ttf';

    private const FONT_EYEBROW = 'BarlowSemiCondensed-SemiBold.ttf';

    private const FONT_TEXT = 'Inter-Medium.ttf';

    /**
     * What the Barlow files hold of what people type: Latin with its extensions and typographic punctuation. GD has no call to ask a
     * font, and comparing boxes cannot tell a letter from Inter's own "NO GLYPH" box. OgImageTextTest checks this against the files.
     *
     * @var list<array{int, int}>
     */
    public const BARLOW_RANGES = [
        [0x20, 0x7E], [0xA0, 0xAC], [0xAE, 0x113], [0x116, 0x12B], [0x12D, 0x131], [0x133, 0x137], [0x139, 0x13E], [0x140, 0x148],
        [0x14A, 0x14D], [0x14F, 0x17E], [0x18F, 0x18F], [0x192, 0x192], [0x1A0, 0x1A1], [0x1AF, 0x1B0], [0x1CD, 0x1CE], [0x218, 0x21B],
        [0x1E80, 0x1E85], [0x1EA0, 0x1EF9], [0x2010, 0x2010], [0x2013, 0x2014], [0x2018, 0x201A], [0x201C, 0x201E], [0x2020, 0x2022],
        [0x2026, 0x2026], [0x2030, 0x2030], [0x2039, 0x203A], [0x20AC, 0x20AC], [0x2122, 0x2122],
    ];

    /**
     * What Inter-Medium holds of the same, plus Greek and Cyrillic. Barlow's list lies within this one, so this is all a card can draw.
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
     * @param  string  $photo  image bytes
     * @param  float|null  $focalX  0 to 1, null for the centre
     * @param  float|null  $focalY  0 to 1, null for the centre
     */
    public function vehicle(string $photo, ?float $focalX, ?float $focalY, ?string $eyebrow, string $title, string $specs): string
    {
        $eyebrow = $this->sanitise((string) $eyebrow);
        $title = $this->sanitise($title);
        $specs = $this->sanitise($specs);

        $image = $this->canvas();
        $this->drawCover($image, $photo, $focalX, $focalY);
        $this->drawScrims($image);
        $this->drawWordmark($image);

        $white = (int) imagecolorallocate($image, 255, 255, 255);
        $baseline = self::HEIGHT - self::MARGIN;

        if ($specs !== '') {
            $this->text($image, self::FONT_TEXT, $specs, 28, 22, self::MARGIN, $baseline, $white);
            $baseline -= 56;
        }

        // A line with nothing left to draw leaves no gap: what is above it moves down.
        if ($title !== '') {
            $this->text($image, self::FONT_DISPLAY, $title, 72, 44, self::MARGIN, $baseline, $white);
            $baseline -= 88;
        }

        if ($eyebrow !== '') {
            $this->text($image, self::FONT_EYEBROW, $eyebrow, 30, 24, self::MARGIN, $baseline, $white);
        }

        return $this->encode($image);
    }

    /**
     * @param  string|null  $cover  image bytes of the member's cover, a plain dark canvas without one
     * @param  string|null  $avatar  image bytes
     */
    public function member(?string $cover, ?float $focalX, ?float $focalY, ?string $avatar, string $name, string $handle, ?string $city): string
    {
        $name = $this->sanitise($name);
        $city = $this->sanitise((string) $city);

        $image = $this->canvas();

        if ($cover !== null) {
            $this->drawCover($image, $cover, $focalX, $focalY);
            $this->drawScrims($image);
        } else {
            imagefilledrectangle($image, 0, 0, self::WIDTH, self::HEIGHT, (int) imagecolorallocate($image, 18, 18, 20));
        }

        $this->drawWordmark($image);

        $white = (int) imagecolorallocate($image, 255, 255, 255);
        $x = self::MARGIN;

        if ($avatar !== null) {
            $this->drawAvatar($image, $avatar, $x, self::HEIGHT - self::MARGIN - self::AVATAR_SIZE);
            $x += 232;
        }

        $baseline = self::HEIGHT - self::MARGIN;
        $line = $handle.($city === '' ? '' : ' · '.$city);

        $this->text($image, self::FONT_TEXT, $line, 28, 22, $x, $baseline, $white);

        if ($name !== '') {
            $this->text($image, self::FONT_DISPLAY, $name, 64, 40, $x, $baseline - 56, $white);
        }

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
     * A line stays in one font: the design's, or Inter when Barlow lacks a letter of it, which keeps a Cyrillic or Greek name readable.
     */
    private function fontFor(string $font, string $text): string
    {
        if ($font === self::FONT_TEXT) {
            return $font;
        }

        foreach (mb_str_split($text) as $character) {
            if (! $this->covers(self::BARLOW_RANGES, $character)) {
                return self::FONT_TEXT;
            }
        }

        return $font;
    }

    private function canvas(): GdImage
    {
        $image = imagecreatetruecolor(self::WIDTH, self::HEIGHT);

        if ($image === false) {
            throw new RuntimeException('GD could not create the OG canvas.');
        }

        imagealphablending($image, true);

        return $image;
    }

    private function load(string $bytes): GdImage
    {
        $source = imagecreatefromstring($bytes);

        return $source === false ? throw new RuntimeException('GD could not read the OG source image.') : $source;
    }

    /**
     * Fills the canvas and keeps the focal point inside the crop, as the page does with object-position (03_DESIGN_SYSTEM §7).
     */
    private function drawCover(GdImage $image, string $bytes, ?float $focalX, ?float $focalY): void
    {
        $source = $this->load($bytes);
        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $scale = max(self::WIDTH / $sourceWidth, self::HEIGHT / $sourceHeight);
        $cropWidth = (int) round(self::WIDTH / $scale);
        $cropHeight = (int) round(self::HEIGHT / $scale);

        $x = (int) round(($sourceWidth * ($focalX ?? 0.5)) - ($cropWidth / 2));
        $y = (int) round(($sourceHeight * ($focalY ?? 0.5)) - ($cropHeight / 2));

        imagecopyresampled(
            $image,
            $source,
            0,
            0,
            max(0, min($x, $sourceWidth - $cropWidth)),
            max(0, min($y, $sourceHeight - $cropHeight)),
            self::WIDTH,
            self::HEIGHT,
            $cropWidth,
            $cropHeight,
        );
    }

    private function drawScrims(GdImage $image): void
    {
        $this->gradient($image, (int) (self::HEIGHT * 0.3), self::HEIGHT, 0.0, 0.82);
        $this->gradient($image, 0, 150, 0.45, 0.0);
    }

    private function gradient(GdImage $image, int $from, int $to, float $startOpacity, float $endOpacity): void
    {
        for ($y = $from; $y < $to; $y++) {
            $opacity = $startOpacity + (($endOpacity - $startOpacity) * (($y - $from) / max(1, $to - $from)));
            // GD counts alpha from 0, opaque, to 127, transparent.
            $color = (int) imagecolorallocatealpha($image, 0, 0, 0, max(0, min(127, 127 - (int) round($opacity * 127))));
            imageline($image, 0, $y, self::WIDTH, $y, $color);
        }
    }

    private function drawWordmark(GdImage $image): void
    {
        $logo = imagecreatefrompng(public_path('brand/logo-wide-white-320.png'));

        if ($logo === false) {
            throw new RuntimeException('GD could not read the wordmark.');
        }

        imagecopy($image, $logo, self::MARGIN - 8, 40, 0, 0, imagesx($logo), imagesy($logo));
    }

    /**
     * Round by a mask: every pixel outside the circle stays what the background is.
     */
    private function drawAvatar(GdImage $image, string $bytes, int $x, int $y): void
    {
        $size = self::AVATAR_SIZE;
        $source = $this->load($bytes);
        $side = min(imagesx($source), imagesy($source));
        $offsetX = (int) ((imagesx($source) - $side) / 2);
        $offsetY = (int) ((imagesy($source) - $side) / 2);
        $radius = $size / 2;

        $scaled = imagecreatetruecolor($size, $size);

        if ($scaled === false) {
            throw new RuntimeException('GD could not create the avatar.');
        }

        imagecopyresampled($scaled, $source, 0, 0, $offsetX, $offsetY, $size, $size, $side, $side);

        for ($row = 0; $row < $size; $row++) {
            for ($column = 0; $column < $size; $column++) {
                if ((($column - $radius + 0.5) ** 2) + (($row - $radius + 0.5) ** 2) <= $radius ** 2) {
                    imagesetpixel($image, $x + $column, $y + $row, (int) imagecolorat($scaled, $column, $row));
                }
            }
        }
    }

    /**
     * Shrinks to $minSize first; a name that is still too long ends in an ellipsis.
     */
    private function text(GdImage $image, string $font, string $text, int $size, int $minSize, int $x, int $baseline, int $color): void
    {
        $path = resource_path('fonts/'.$this->fontFor($font, $text));
        $maxWidth = self::WIDTH - $x - self::MARGIN;

        while ($size > $minSize && $this->width($path, $size, $text) > $maxWidth) {
            $size -= 2;
        }

        if ($this->width($path, $size, $text) > $maxWidth) {
            while (mb_strlen($text) > 1 && $this->width($path, $size, $text.'…') > $maxWidth) {
                $text = mb_substr($text, 0, -1);
            }

            $text = rtrim($text).'…';
        }

        imagettftext($image, $size, 0, $x, $baseline, $color, $path, $this->literal($text));
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

    private function encode(GdImage $image): string
    {
        ob_start();
        imageinterlace($image, true);
        imagejpeg($image, null, self::QUALITY);

        return (string) ob_get_clean();
    }
}
