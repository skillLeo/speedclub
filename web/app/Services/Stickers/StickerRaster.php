<?php

namespace App\Services\Stickers;

use GdImage;
use RuntimeException;

/**
 * The sticker as pixels with GD, from the same artwork as the SVG and the PDF (m5.4-contract §6.3, §4). `print`: inks only on a
 * transparent background (the vinyl where it is white), mirrored when the design is: what the printer lays down. `seen`: the same
 * on the surface it is made for (dark glass or light paint), as a camera sees it from outside the car, so a mirrored design reads the
 * right way round. The Scan-Test decodes `seen`.
 */
final class StickerRaster
{
    public const PRINT_DPI = 300;

    /**
     * @param  'print'|'seen'  $mode
     * @param  int  $padding  pixels of surface around the sticker (seen only)
     */
    public function render(StickerArtwork $artwork, float $pxPerMm, string $mode, int $padding = 0): GdImage
    {
        $padding = $mode === 'seen' ? $padding : 0;
        $width = (int) ceil($artwork->width * $pxPerMm) + 2 * $padding;
        $height = (int) ceil($artwork->height * $pxPerMm) + 2 * $padding;
        $image = imagecreatetruecolor(max(1, $width), max(1, $height));

        if (! $image instanceof GdImage) {
            throw new RuntimeException('GD could not create the sticker canvas.');
        }

        imagealphablending($image, false);
        imagesavealpha($image, true);

        if ($mode === 'print') {
            imagefilledrectangle($image, 0, 0, $width, $height, (int) imagecolorallocatealpha($image, 0, 0, 0, 127));
        } else {
            imagefilledrectangle($image, 0, 0, $width, $height, $this->colour($image, StickerInks::surface($artwork->colourway)));
        }

        imagealphablending($image, true);

        $base = StickerInks::base($artwork->colourway, $artwork->material);

        if ($artwork->material->value === 'white_vinyl' || $mode === 'seen') {
            $this->shape($image, $artwork, $pxPerMm, $padding, $this->colour($image, $base));
        }

        foreach ($artwork->elements as $element) {
            $this->element($image, $artwork, $element, $pxPerMm, $padding);
        }

        if ($artwork->mirrored && $mode === 'print') {
            imageflip($image, IMG_FLIP_HORIZONTAL);
        }

        return $image;
    }

    public function png(GdImage $image): string
    {
        ob_start();
        imagepng($image, null, 6);

        return (string) ob_get_clean();
    }

    /**
     * @param  array<string, mixed>  $element
     */
    private function element(GdImage $image, StickerArtwork $artwork, array $element, float $s, int $pad): void
    {
        $x = $pad + (float) $element['x'] * $s;
        $y = $pad + (float) ($element['y'] ?? 0.0) * $s;
        $ink = (string) ($element['ink'] ?? $artwork->mainInk());

        switch ($element['kind']) {
            case 'logo':
                $this->logo($image, $ink, $x, $y, (float) ($element['w'] ?? 0.0) * $s, (float) ($element['h'] ?? 0.0) * $s, ($element['rotate'] ?? 0) === 90);

                return;

            case 'bar':
                imagefilledrectangle($image, (int) round($x), (int) round($y), (int) round($x + (float) ($element['w'] ?? 0.0) * $s) - 1, (int) round($y + (float) ($element['h'] ?? 0.0) * $s) - 1, $this->colour($image, StickerInks::rgb($ink)));

                return;

            case 'text':
                // GD takes points at 96 dpi: an em of E pixels is E × 72/96 points.
                imagettftext($image, (float) $element['size'] * $s * 0.75, 0, (int) round($x), (int) round($pad + (float) $element['baseline'] * $s), $this->colour($image, StickerInks::rgb($ink)), StickerFonts::path((string) $element['font']), (string) $element['text']);

                return;

            case 'qr':
                $module = (float) $element['size'] * $s / ((int) $element['modules'] + 2 * StickerCatalogue::QUIET_ZONE_MODULES);
                $colour = $this->colour($image, StickerInks::rgb($artwork->mainInk()));

                foreach (StickerQrRuns::ink($artwork, $element) as [$runX, $runY, $length]) {
                    imagefilledrectangle(
                        $image,
                        (int) round($x + $runX * $module),
                        (int) round($y + $runY * $module),
                        (int) round($x + ($runX + $length) * $module) - 1,
                        (int) round($y + ($runY + 1) * $module) - 1,
                        $colour,
                    );
                }
        }
    }

    private function logo(GdImage $image, string $ink, float $x, float $y, float $w, float $h, bool $turned): void
    {
        $logo = imagecreatefromstring(StickerLogo::png($ink));

        if (! $logo instanceof GdImage) {
            throw new RuntimeException('GD could not read the logo.');
        }

        if ($turned) {
            imagealphablending($logo, false);
            imagesavealpha($logo, true);
            // GD turns counter-clockwise: 270° is a quarter turn clockwise, so the logo reads from top to bottom.
            $rotated = imagerotate($logo, 270, (int) imagecolorallocatealpha($logo, 0, 0, 0, 127));
            $logo = $rotated instanceof GdImage ? $rotated : $logo;
        }

        imagecopyresampled($image, $logo, (int) round($x), (int) round($y), 0, 0, max(1, (int) round($w)), max(1, (int) round($h)), imagesx($logo), imagesy($logo));
    }

    private function shape(GdImage $image, StickerArtwork $artwork, float $s, int $pad, int $colour): void
    {
        $w = $artwork->width * $s;
        $h = $artwork->height * $s;

        if ($artwork->shape === 'circle') {
            imagefilledellipse($image, (int) round($pad + $w / 2), (int) round($pad + $h / 2), (int) round($w), (int) round($h), $colour);

            return;
        }

        $r = $artwork->shape === 'rounded' ? (int) round(min($artwork->radius * $s, $w / 2, $h / 2)) : 0;
        $x0 = $pad;
        $y0 = $pad;
        $x1 = (int) round($pad + $w) - 1;
        $y1 = (int) round($pad + $h) - 1;

        if ($r <= 0) {
            imagefilledrectangle($image, $x0, $y0, $x1, $y1, $colour);

            return;
        }

        imagefilledrectangle($image, $x0 + $r, $y0, $x1 - $r, $y1, $colour);
        imagefilledrectangle($image, $x0, $y0 + $r, $x1, $y1 - $r, $colour);

        foreach ([[$x0 + $r, $y0 + $r], [$x1 - $r, $y0 + $r], [$x0 + $r, $y1 - $r], [$x1 - $r, $y1 - $r]] as [$cx, $cy]) {
            imagefilledellipse($image, $cx, $cy, 2 * $r, 2 * $r, $colour);
        }
    }

    /**
     * @param  array{int, int, int}  $rgb
     */
    private function colour(GdImage $image, array $rgb): int
    {
        return (int) imagecolorallocate($image, max(0, min(255, $rgb[0])), max(0, min(255, $rgb[1])), max(0, min(255, $rgb[2])));
    }
}
