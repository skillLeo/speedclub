<?php

namespace App\Services\Wrapped;

use App\Services\PublicPages\OgImageCanvas;
use App\Support\DesignTokens;
use GdImage;
use RuntimeException;

/**
 * Draws one Wrapped card as a 1080 × 1920 PNG with GD (m5.9e contract §5), the approach of the VEH-07 share card (ShareCardCanvas):
 * the same fonts from resources/fonts (Archivo Condensed for numerals, Archivo SemiExpanded for names, Inter for text), colours from the
 * design tokens (carbon), the delivered wordmark, text a font cannot draw left out (OgImageCanvas::sanitise). Typography-led on the
 * dark canvas; a photo (blurred master variants only) fills the upper part when the card has one; one short accent rule is the only
 * red. The share card itself is drawn by ShareCardCanvas (WrappedCardImages).
 *
 * `photo_height`: 1080 for the top mod; the intro, score and Build Spirit cards (ADR-516 a) pass the shorter PHOTO_SHORT, so their numeral
 * or longer explanation and the footer keep their room below the photo.
 *
 * @phpstan-type Spec array{logo: bool, eyebrow: string, headline: string, numeral: bool, lines: list<string>, footer: string, photo: string|null, focal: array{0: float|null, 1: float|null}, qr: string|null, photo_height: int}
 */
final class WrappedCardCanvas
{
    public const WIDTH = 1080;

    public const HEIGHT = 1920;

    /** The photo's height on a card with a numeral or a longer text under it. */
    public const PHOTO_SHORT = 900;

    private const MARGIN = 88;

    private const FONT_DISPLAY = 'ArchivoSemiExpanded-SemiBold.ttf';

    private const FONT_NUMERALS = 'ArchivoCondensed-SemiBold.ttf';

    private const FONT_TEXT = 'Inter-Medium.ttf';

    public function __construct(private readonly OgImageCanvas $og) {}

    /**
     * @param  Spec  $spec
     * @return string PNG bytes
     */
    public function draw(array $spec): string
    {
        $image = imagecreatetruecolor(self::WIDTH, self::HEIGHT);

        if (! $image instanceof GdImage) {
            throw new RuntimeException('GD could not create the Wrapped card.');
        }

        imagealphablending($image, true);
        imagefilledrectangle($image, 0, 0, self::WIDTH - 1, self::HEIGHT - 1, $this->token($image, 'bg-canvas'));
        $top = $spec['logo'] ? 560 : 480;

        if ($spec['photo'] !== null) {
            $height = $spec['photo_height'];
            $this->photo($image, $spec['photo'], $spec['focal'][0], $spec['focal'][1], $height);
            $top = $height + 96;
        }

        // The brush wordmark is a brand moment: the intro only here (the share card is ShareCardCanvas's, with its own).
        if ($spec['logo']) {
            $this->logo($image, 72, 360);
        }

        $right = self::WIDTH - self::MARGIN;
        $y = $top;

        $eyebrow = $this->og->sanitise($spec['eyebrow']);

        if ($eyebrow !== '') {
            $y = $this->paragraph($image, self::FONT_TEXT, $eyebrow, 40, $y, $right, $this->token($image, 'text-secondary'), 2) + 28;
            imagefilledrectangle($image, self::MARGIN, $y, self::MARGIN + 96, $y + 7, $this->token($image, 'accent-fill'));
            $y += 64;
        }

        $headline = $this->og->sanitise($spec['headline']);

        if ($headline !== '') {
            $font = $spec['numeral'] ? self::FONT_NUMERALS : self::FONT_DISPLAY;
            // Inter when Archivo lacks a letter of it, as on the share card.
            $font = $this->archivoCovers($headline) ? $font : self::FONT_TEXT;
            $size = $spec['numeral'] ? 260 : 104;
            $size = $this->fit($font, $headline, $size, $spec['numeral'] ? 120 : 64, $right - self::MARGIN, $spec['numeral'] ? 1 : 3);
            $y = $this->paragraph($image, $font, $headline, $size, $y + $size, $right, $this->token($image, 'text-primary'), $spec['numeral'] ? 1 : 3, false) + 56;
        }

        foreach ($spec['lines'] as $line) {
            $line = $this->og->sanitise($line);

            if ($line !== '' && $y < self::HEIGHT - 260) {
                $y = $this->paragraph($image, self::FONT_TEXT, $line, 44, $y + 44, $right - ($spec['qr'] === null ? 0 : 360), $this->token($image, 'text-secondary'), 3, false) + 28;
            }
        }

        if ($spec['qr'] !== null) {
            $this->qr($image, $spec['qr'], self::WIDTH - self::MARGIN - 300, self::HEIGHT - self::MARGIN - 360, 300);
        }

        $footer = $this->og->sanitise($spec['footer']);

        if ($footer !== '') {
            imagettftext($image, 32, 0, self::MARGIN, self::HEIGHT - self::MARGIN, $this->token($image, 'text-tertiary'), $this->font(self::FONT_TEXT), $this->escape($footer));
        }

        ob_start();
        imagepng($image, null, 6);

        return (string) ob_get_clean();
    }

    /**
     * Wraps $text into at most $maxLines lines (the last ends in an ellipsis) and draws them; returns the baseline of the last line.
     * $y is the top of the first line when $firstIsTop, else its baseline.
     */
    private function paragraph(GdImage $image, string $font, string $text, int $size, int $y, int $right, int $color, int $maxLines, bool $firstIsTop = true): int
    {
        $path = $this->font($font);
        $lines = $this->wrap($path, $text, $size, $right - self::MARGIN, $maxLines);
        $baseline = $firstIsTop ? $y + $size : $y;
        $leading = (int) round($size * ($font === self::FONT_TEXT ? 1.5 : 1.2));

        foreach ($lines as $index => $line) {
            imagettftext($image, $size, 0, self::MARGIN, $baseline + ($index * $leading), $color, $path, $this->escape($line));
        }

        return $baseline + ((count($lines) - 1) * $leading);
    }

    /**
     * @return list<string>
     */
    private function wrap(string $path, string $text, int $size, int $width, int $maxLines): array
    {
        $words = preg_split('/\s+/u', $text) ?: [];
        $lines = [];
        $current = '';

        foreach ($words as $word) {
            $candidate = $current === '' ? $word : $current.' '.$word;

            if ($current !== '' && $this->width($path, $size, $candidate) > $width) {
                $lines[] = $current;
                $current = $word;
            } else {
                $current = $candidate;
            }
        }

        if ($current !== '') {
            $lines[] = $current;
        }

        if (count($lines) > $maxLines) {
            $lines = array_slice($lines, 0, $maxLines);
            $last = $lines[$maxLines - 1];

            while (mb_strlen($last) > 1 && $this->width($path, $size, $last.'…') > $width) {
                $last = mb_substr($last, 0, -1);
            }

            $lines[$maxLines - 1] = rtrim($last).'…';
        }

        return array_values($lines);
    }

    /** The largest size from $size down to $min at which $text fits in $maxLines lines of $width. */
    private function fit(string $font, string $text, int $size, int $min, int $width, int $maxLines): int
    {
        $path = $this->font($font);

        while ($size > $min) {
            $lines = $this->wrap($path, $text, $size, $width, PHP_INT_MAX);

            if ($lines === [] || count($lines) <= $maxLines && max(array_map(fn (string $line): int => $this->width($path, $size, $line), $lines)) <= $width) {
                break;
            }

            $size -= 8;
        }

        return max($min, $size);
    }

    private function photo(GdImage $image, string $bytes, ?float $focalX, ?float $focalY, int $height): void
    {
        $source = @imagecreatefromstring($bytes);

        if (! $source instanceof GdImage) {
            return;
        }

        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $scale = max(self::WIDTH / $sourceWidth, $height / $sourceHeight);
        $cropWidth = (int) round(self::WIDTH / $scale);
        $cropHeight = (int) round($height / $scale);
        $x = (int) round(($sourceWidth * ($focalX ?? 0.5)) - ($cropWidth / 2));
        $y = (int) round(($sourceHeight * ($focalY ?? 0.5)) - ($cropHeight / 2));

        imagecopyresampled($image, $source, 0, 0, max(0, min($x, $sourceWidth - $cropWidth)), max(0, min($y, $sourceHeight - $cropHeight)), self::WIDTH, $height, $cropWidth, $cropHeight);

        // The scrims of the share card: the wordmark stays legible on top, the photo runs into the canvas at the bottom.
        $canvas = DesignTokens::rgba('bg-canvas');

        for ($row = 0; $row < $height; $row++) {
            $opacity = $row < 220 ? 0.5 * (1 - $row / 220) : ($row > $height - 360 ? ($row - ($height - 360)) / 360 : 0.0);

            if ($opacity > 0) {
                $color = (int) imagecolorallocatealpha($image, $canvas[0], $canvas[1], $canvas[2], max(0, min(127, 127 - (int) round($opacity * 127))));
                imageline($image, 0, $row, self::WIDTH, $row, $color);
            }
        }
    }

    private function logo(GdImage $image, int $y, int $targetWidth): void
    {
        $logo = @imagecreatefrompng(public_path('brand/logo-wide-white-640.png'));

        if (! $logo instanceof GdImage) {
            throw new RuntimeException('GD could not read the wordmark.');
        }

        imagealphablending($logo, true);
        $targetHeight = (int) round(imagesy($logo) * $targetWidth / imagesx($logo));
        imagecopyresampled($image, $logo, self::MARGIN - 8, $y, 0, 0, $targetWidth, $targetHeight, imagesx($logo), imagesy($logo));
    }

    /** The sticker's code on its white panel with the quiet zone (FS-9), as on the share card. */
    private function qr(GdImage $image, string $png, int $x, int $y, int $size): void
    {
        $code = @imagecreatefromstring($png);

        if (! $code instanceof GdImage) {
            return;
        }

        imagefilledrectangle($image, $x, $y, $x + $size - 1, $y + $size - 1, $this->token($image, 'qr-bg'));
        imagecopyresampled($image, $code, $x, $y, 0, 0, $size, $size, imagesx($code), imagesy($code));
    }

    private function archivoCovers(string $text): bool
    {
        foreach (mb_str_split($text) as $character) {
            $codePoint = mb_ord($character);
            $covered = false;

            foreach (OgImageCanvas::ARCHIVO_RANGES as [$from, $to]) {
                if ($codePoint >= $from && $codePoint <= $to) {
                    $covered = true;

                    break;
                }
            }

            if (! $covered) {
                return false;
            }
        }

        return true;
    }

    private function token(GdImage $image, string $token): int
    {
        [$red, $green, $blue, $alpha] = DesignTokens::rgba($token);

        return (int) imagecolorallocatealpha($image, $red, $green, $blue, max(0, min(127, 127 - (int) round($alpha * 127))));
    }

    private function font(string $font): string
    {
        return resource_path('fonts/'.$font);
    }

    private function width(string $path, int $size, string $text): int
    {
        $box = imagettfbbox($size, 0, $path, $this->escape($text));

        return $box === false ? 0 : abs($box[2] - $box[0]);
    }

    private function escape(string $text): string
    {
        return str_replace('&', '&#38;', $text);
    }
}
