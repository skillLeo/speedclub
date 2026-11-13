<?php

namespace App\Services\Signature;

use App\Services\PublicPages\OgImageCanvas;
use GdImage;
use RuntimeException;

/**
 * Draws a VEH-07 share card with GD [SIG sig.share_cards] (02_PRODUCT_SPEC §5, m2.7-contract §1): the cover photo filling the card around its
 * focal point, a scrim for legibility, the client's wordmark as delivered (brand layer, 03_DESIGN_SYSTEM §2), make, model and three specs,
 * the @username when the owner shows themselves, and the QR code black on white with its quiet zone, the wordmark beside it on the same white
 * panel, never inside the code (§3.4). Fonts from resources/fonts, as the OG images; text a font cannot draw is left out (OgImageCanvas).
 */
final class ShareCardCanvas
{
    /** @var array<string, array{0: int, 1: int}> width and height per format */
    public const FORMATS = ['story' => [1080, 1920], 'square' => [1080, 1080]];

    private const MARGIN = 72;

    /** display.title (09 §4.2, §8.5): the make and the name in Archivo SemiExpanded. */
    private const FONT_DISPLAY = 'ArchivoSemiExpanded-SemiBold.ttf';

    /** The spec numerals in Archivo Condensed, as the SpecStrip. */
    private const FONT_NUMERALS = 'ArchivoCondensed-SemiBold.ttf';

    private const FONT_TEXT = 'Inter-Medium.ttf';

    public function __construct(private readonly OgImageCanvas $og) {}

    /**
     * @param  string  $photo  image bytes of the cover's largest variant
     * @param  string|null  $qr  PNG of the code, square, with its quiet zone; null draws no panel
     * @return string PNG bytes
     */
    public function draw(string $format, string $photo, ?float $focalX, ?float $focalY, ?string $eyebrow, string $title, string $specs, ?string $handle, ?string $qr): string
    {
        [$width, $height] = self::FORMATS[$format] ?? throw new RuntimeException("Unknown share card format [$format].");
        $image = imagecreatetruecolor($width, $height);

        if (! $image instanceof GdImage) {
            throw new RuntimeException('GD could not create the share card.');
        }

        imagealphablending($image, true);
        $this->cover($image, $photo, $focalX, $focalY, $width, $height);
        $this->gradient($image, $width, (int) ($height * 0.38), $height, 0.0, 0.88);
        $this->gradient($image, $width, 0, 220, 0.5, 0.0);
        $this->logo($image, 'brand/logo-wide-white-640.png', self::MARGIN - 8, 64, 360);

        $white = (int) imagecolorallocate($image, 255, 255, 255);
        $muted = (int) imagecolorallocatealpha($image, 255, 255, 255, 30);
        $panel = $qr === null ? 0 : ($format === 'story' ? 300 : 260);
        $textRight = $width - self::MARGIN - ($panel === 0 ? 0 : $panel + 40);
        $baseline = $height - self::MARGIN - ($format === 'story' ? 24 : 8);

        if ($qr !== null) {
            $this->qrPanel($image, $qr, $width - self::MARGIN - $panel, $height - self::MARGIN - $panel - 56, $panel);
        }

        $handle = $handle === null ? '' : $this->og->sanitise($handle);
        $specs = $this->og->sanitise($specs);
        $title = $this->og->sanitise($title);
        $eyebrow = $this->og->sanitise((string) $eyebrow);

        if ($handle !== '') {
            $this->text($image, self::FONT_TEXT, $handle, 32, 24, self::MARGIN, $baseline, $textRight, $muted);
            $baseline -= 64;
        }

        if ($specs !== '') {
            $this->text($image, self::FONT_NUMERALS, $specs, 36, 24, self::MARGIN, $baseline, $textRight, $white);
            $baseline -= 72;
        }

        if ($title !== '') {
            $size = $format === 'story' ? 96 : 84;
            $this->text($image, self::FONT_DISPLAY, $title, $size, 48, self::MARGIN, $baseline, $textRight, $white);
            $baseline -= $size + 24;
        }

        if ($eyebrow !== '') {
            $this->text($image, self::FONT_DISPLAY, $eyebrow, 38, 28, self::MARGIN, $baseline, $textRight, $white);
        }

        ob_start();
        imagepng($image, null, 6);

        return (string) ob_get_clean();
    }

    private function cover(GdImage $image, string $bytes, ?float $focalX, ?float $focalY, int $width, int $height): void
    {
        $source = @imagecreatefromstring($bytes);

        if (! $source instanceof GdImage) {
            throw new RuntimeException('GD could not read the share card photo.');
        }

        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $scale = max($width / $sourceWidth, $height / $sourceHeight);
        $cropWidth = (int) round($width / $scale);
        $cropHeight = (int) round($height / $scale);
        $x = (int) round(($sourceWidth * ($focalX ?? 0.5)) - ($cropWidth / 2));
        $y = (int) round(($sourceHeight * ($focalY ?? 0.5)) - ($cropHeight / 2));

        imagecopyresampled(
            $image,
            $source,
            0,
            0,
            max(0, min($x, $sourceWidth - $cropWidth)),
            max(0, min($y, $sourceHeight - $cropHeight)),
            $width,
            $height,
            $cropWidth,
            $cropHeight,
        );
    }

    private function gradient(GdImage $image, int $width, int $from, int $to, float $startOpacity, float $endOpacity): void
    {
        for ($y = $from; $y < $to; $y++) {
            $opacity = $startOpacity + (($endOpacity - $startOpacity) * (($y - $from) / max(1, $to - $from)));
            $color = (int) imagecolorallocatealpha($image, 0, 0, 0, max(0, min(127, 127 - (int) round($opacity * 127))));
            imageline($image, 0, $y, $width, $y, $color);
        }
    }

    /**
     * The delivered wordmark, scaled to $targetWidth with its own proportions.
     */
    private function logo(GdImage $image, string $file, int $x, int $y, int $targetWidth): void
    {
        $logo = @imagecreatefrompng(public_path($file));

        if (! $logo instanceof GdImage) {
            throw new RuntimeException('GD could not read the wordmark.');
        }

        imagealphablending($logo, true);
        $targetHeight = (int) round(imagesy($logo) * $targetWidth / imagesx($logo));
        imagecopyresampled($image, $logo, $x, $y, 0, 0, $targetWidth, $targetHeight, imagesx($logo), imagesy($logo));
    }

    /**
     * White panel: the code at full size (its quiet zone is white already), the black wordmark under it on the same white.
     */
    private function qrPanel(GdImage $image, string $png, int $x, int $y, int $size): void
    {
        $code = @imagecreatefromstring($png);

        if (! $code instanceof GdImage) {
            throw new RuntimeException('GD could not read the QR code.');
        }

        $white = (int) imagecolorallocate($image, 255, 255, 255);
        imagefilledrectangle($image, $x, $y, $x + $size - 1, $y + $size + 56, $white);
        imagecopyresampled($image, $code, $x, $y, 0, 0, $size, $size, imagesx($code), imagesy($code));
        $this->logo($image, 'brand/logo-wide-black-640.png', $x + (int) ($size * 0.2), $y + $size + 4, (int) ($size * 0.6));
    }

    /**
     * Shrinks to $minSize first, then ends in an ellipsis; a line stays in one font, Inter when Archivo lacks a letter of it.
     */
    private function text(GdImage $image, string $font, string $text, int $size, int $minSize, int $x, int $baseline, int $right, int $color): void
    {
        if ($font !== self::FONT_TEXT && ! $this->archivoCovers($text)) {
            $font = self::FONT_TEXT;
        }

        $path = resource_path('fonts/'.$font);
        $maxWidth = max(1, $right - $x);

        while ($size > $minSize && $this->width($path, $size, $text) > $maxWidth) {
            $size -= 2;
        }

        if ($this->width($path, $size, $text) > $maxWidth) {
            while (mb_strlen($text) > 1 && $this->width($path, $size, $text.'…') > $maxWidth) {
                $text = mb_substr($text, 0, -1);
            }

            $text = rtrim($text).'…';
        }

        imagettftext($image, $size, 0, $x, $baseline, $color, $path, str_replace('&', '&#38;', $text));
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

    private function width(string $font, int $size, string $text): int
    {
        $box = imagettfbbox($size, 0, $font, str_replace('&', '&#38;', $text));

        return $box === false ? 0 : abs($box[2] - $box[0]);
    }
}
