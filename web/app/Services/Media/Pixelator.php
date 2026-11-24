<?php

namespace App\Services\Media;

use GdImage;
use Illuminate\Image\ImageException;

/**
 * [SIG sig.plate_blur] Pixelates regions of a photo with GD (02_PRODUCT_SPEC §5, §9, ADR-509): each region is averaged down to square
 * blocks and drawn back up without smoothing. Averaging throws the detail away, so what was under a block cannot be read back from the
 * file, unlike a blur that a sharpen filter could partly undo.
 *
 * Block size (ADR-509, M5.9a): at least a third of the region's height, so a plate is at most 3 block rows high — fine pixelation of a
 * close-up plate can be partly reversed by known-font depixelation — and never below the photo-wide floor of 1/60 of the long side
 * (at least 8 px) that GAR-08 used before.
 *
 * Angle (M5.9a, client round): a region may carry `angle`, degrees clockwise about its centre (−45…45, absent = 0). The rectangle {x, y,
 * w, h} is then the unrotated one, turned in pixel space as the app draws it. Its axis-aligned bounding area is pixelated in a buffer and
 * only the rotated polygon (grown by a pixel, so its edge is never left out) is filled back from it, through a GD tile: native fill, no
 * per-pixel loop, and nothing outside the polygon changes. A region without an angle takes the exact v1 path.
 *
 * @phpstan-type Region array{x: float|int, y: float|int, w: float|int, h: float|int, angle?: float|int}
 */
final class Pixelator
{
    private const BLOCKS_PER_SIDE = 60;

    private const MIN_BLOCK = 8;

    /** A region is at most this many blocks high. */
    public const MAX_ROWS = 3;

    /** A turned region is at most this many degrees either way (the API's `angle` range). */
    public const MAX_ANGLE = 45.0;

    /** The rotated polygon grows by this many pixels on every side: GD's fill rounds its edge, and no edge of a plate may stay. */
    private const EDGE_GROW = 1.5;

    /**
     * Pixelates in place. Called by ImageProcessor on the decoded, oriented photo (PixelateRegions), before anything is encoded.
     *
     * @param  list<Region>  $regions  normalised 0–1 from the top left
     */
    public function pixelate(GdImage $image, array $regions): void
    {
        $width = imagesx($image);
        $height = imagesy($image);

        foreach ($regions as $region) {
            if (self::angleOf($region) !== 0.0) {
                $this->pixelateRotated($image, $region, $width, $height);

                continue;
            }

            [$left, $top, $right, $bottom] = $this->bounds($region, $width, $height);
            $regionWidth = $right - $left;
            $regionHeight = $bottom - $top;

            if ($regionWidth < 1 || $regionHeight < 1) {
                continue;
            }

            $this->blocks($image, $left, $top, $regionWidth, $regionHeight, self::blockSize($width, $height, $regionHeight));
        }
    }

    /**
     * The region's angle in degrees, clamped to the API's range; 0 without one.
     *
     * @param  Region  $region
     */
    public static function angleOf(array $region): float
    {
        $angle = (float) ($region['angle'] ?? 0.0);

        return max(-self::MAX_ANGLE, min(self::MAX_ANGLE, $angle));
    }

    /**
     * The four corners of the rotated rectangle in pixels (clockwise from the top left), grown outwards by `$grow` pixels on every side.
     *
     * @param  Region  $region
     * @return list<array{0: float, 1: float}>
     */
    public static function corners(array $region, int $width, int $height, float $grow = 0.0): array
    {
        $halfWidth = (float) $region['w'] * $width / 2 + $grow;
        $halfHeight = (float) $region['h'] * $height / 2 + $grow;
        $centreX = (float) $region['x'] * $width + (float) $region['w'] * $width / 2;
        $centreY = (float) $region['y'] * $height + (float) $region['h'] * $height / 2;
        $radians = deg2rad(self::angleOf($region));
        $cos = cos($radians);
        $sin = sin($radians);

        return array_map(
            fn (array $corner): array => [$centreX + $corner[0] * $cos - $corner[1] * $sin, $centreY + $corner[0] * $sin + $corner[1] * $cos],
            [[-$halfWidth, -$halfHeight], [$halfWidth, -$halfHeight], [$halfWidth, $halfHeight], [-$halfWidth, $halfHeight]],
        );
    }

    /**
     * A turned region: the bounding area of the rotated rectangle is pixelated in a buffer, then only the polygon is filled from it.
     *
     * @param  Region  $region
     */
    private function pixelateRotated(GdImage $image, array $region, int $width, int $height): void
    {
        $corners = self::corners($region, $width, $height, self::EDGE_GROW);
        [$minX, $minY] = [INF, INF];
        [$maxX, $maxY] = [-INF, -INF];
        foreach ($corners as [$x, $y]) {
            [$minX, $minY, $maxX, $maxY] = [min($minX, $x), min($minY, $y), max($maxX, $x), max($maxY, $y)];
        }
        $left = (int) max(0, floor($minX));
        $top = (int) max(0, floor($minY));
        $right = (int) min($width, ceil($maxX));
        $bottom = (int) min($height, ceil($maxY));
        $areaWidth = $right - $left;
        $areaHeight = $bottom - $top;

        if ($areaWidth < 1 || $areaHeight < 1) {
            return;
        }

        $area = $this->canvas($areaWidth, $areaHeight);
        imagecopy($area, $image, 0, 0, $left, $top, $areaWidth, $areaHeight);
        // The block follows the plate's own height, as an unturned region's does.
        $this->blocks($area, 0, 0, $areaWidth, $areaHeight, self::blockSize($width, $height, (int) ceil((float) $region['h'] * $height)));

        // GD tiles from the photo's origin (pixel x, y takes tile pixel x mod w, y mod h): the buffer is rolled so that its pixels land
        // on the spot they came from.
        $tile = $this->canvas($areaWidth, $areaHeight);
        $shiftX = $left % $areaWidth;
        $shiftY = $top % $areaHeight;
        foreach ([[0, 0], [1, 0], [0, 1], [1, 1]] as [$wrapX, $wrapY]) {
            $sourceX = $wrapX === 0 ? 0 : $areaWidth - $shiftX;
            $sourceY = $wrapY === 0 ? 0 : $areaHeight - $shiftY;
            $copyWidth = $wrapX === 0 ? $areaWidth - $shiftX : $shiftX;
            $copyHeight = $wrapY === 0 ? $areaHeight - $shiftY : $shiftY;

            if ($copyWidth > 0 && $copyHeight > 0) {
                imagecopy($tile, $area, $wrapX === 0 ? $shiftX : 0, $wrapY === 0 ? $shiftY : 0, $sourceX, $sourceY, $copyWidth, $copyHeight);
            }
        }

        $points = [];
        foreach ($corners as [$x, $y]) {
            $points[] = (int) round($x);
            $points[] = (int) round($y);
        }

        imagesettile($image, $tile);
        imagefilledpolygon($image, $points, IMG_COLOR_TILED);
    }

    /**
     * Square blocks over one axis-aligned area, in place: area average down (every source pixel counts), nearest neighbour up, so flat
     * blocks remain and nothing of the detail.
     */
    private function blocks(GdImage $image, int $left, int $top, int $areaWidth, int $areaHeight, int $block): void
    {
        $columns = max(1, intdiv($areaWidth + $block - 1, $block));
        $rows = max(1, intdiv($areaHeight + $block - 1, $block));
        $small = $this->canvas($columns, $rows);

        imagecopyresampled($small, $image, 0, 0, $left, $top, $columns, $rows, $areaWidth, $areaHeight);
        imagecopyresized($image, $small, $left, $top, 0, 0, $areaWidth, $areaHeight, $columns, $rows);
    }

    private function canvas(int $width, int $height): GdImage
    {
        $canvas = imagecreatetruecolor(max(1, $width), max(1, $height));

        if (! $canvas instanceof GdImage) {
            throw new ImageException('GD could not create the pixelation buffer.');
        }

        return $canvas;
    }

    /**
     * Edge of one square block in pixels for a region of the given pixel height on a photo of the given size.
     */
    public static function blockSize(int $width, int $height, int $regionHeight): int
    {
        return max(
            self::MIN_BLOCK,
            (int) round(max($width, $height) / self::BLOCKS_PER_SIDE),
            (int) ceil($regionHeight / self::MAX_ROWS),
        );
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
