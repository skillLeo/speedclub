<?php

namespace App\Services\Media;

use GdImage;
use Illuminate\Image\ImageException;

/**
 * [SIG sig.plate_blur] Pixelates regions of a photo with GD (02_PRODUCT_SPEC §5, §9): each region is averaged down to blocks of about 1/60 of
 * the photo's long side (at least 8 px) and drawn back up without smoothing. Averaging throws the detail away, so what was under a block
 * cannot be read back from the file, unlike a blur that a sharpen filter could partly undo.
 *
 * @phpstan-type Region array{x: float|int, y: float|int, w: float|int, h: float|int}
 */
final class Pixelator
{
    private const BLOCKS_PER_SIDE = 60;

    private const MIN_BLOCK = 8;

    /**
     * @param  string  $jpeg  the private original, oriented as displayed
     * @param  list<Region>  $regions  normalised 0–1 from the top left
     * @return string a JPEG at the original quality, without any metadata (GD writes pixels only)
     */
    public function apply(string $jpeg, array $regions): string
    {
        $image = @imagecreatefromstring($jpeg);

        if (! $image instanceof GdImage) {
            throw new ImageException('The original could not be decoded for pixelation.');
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $block = max(self::MIN_BLOCK, (int) round(max($width, $height) / self::BLOCKS_PER_SIDE));

        foreach ($regions as $region) {
            [$left, $top, $right, $bottom] = $this->bounds($region, $width, $height);
            $regionWidth = $right - $left;
            $regionHeight = $bottom - $top;

            if ($regionWidth < 1 || $regionHeight < 1) {
                continue;
            }

            $columns = max(1, intdiv($regionWidth + $block - 1, $block));
            $rows = max(1, intdiv($regionHeight + $block - 1, $block));
            $small = imagecreatetruecolor($columns, $rows);

            if (! $small instanceof GdImage) {
                throw new ImageException('GD could not create the pixelation buffer.');
            }

            imagecopyresampled($small, $image, 0, 0, $left, $top, $columns, $rows, $regionWidth, $regionHeight);
            imagecopyresized($image, $small, $left, $top, 0, 0, $regionWidth, $regionHeight, $columns, $rows);
        }

        ob_start();
        imagejpeg($image, null, max(1, min(100, config()->integer('speedclub.media.original_quality'))));

        return (string) ob_get_clean();
    }

    /**
     * Whole pixels, rounded outwards, so the edge of a plate is never left out, and clipped to the photo.
     *
     * @param  Region  $region
     * @return array{0: int, 1: int, 2: int, 3: int}
     */
    private function bounds(array $region, int $width, int $height): array
    {
        $clamp = fn (float $value): float => max(0.0, min(1.0, $value));
        $x = $clamp((float) $region['x']);
        $y = $clamp((float) $region['y']);

        return [
            (int) floor($x * $width),
            (int) floor($y * $height),
            (int) min($width, ceil($clamp($x + (float) $region['w']) * $width)),
            (int) min($height, ceil($clamp($y + (float) $region['h']) * $height)),
        ];
    }
}
