<?php

namespace App\Services\Media;

use Illuminate\Image\ImageException;
use Illuminate\Support\Facades\Image;
use kornrunner\Blurhash\Blurhash;

/**
 * Re-encodes an image through GD (05_ARCHITECTURE §9). GD writes pixels only, so EXIF, GPS, ICC, comments and any
 * bytes appended to the source never reach an output. Every variant comes from the clean JPEG, not from the source.
 */
class ImageProcessor
{
    /**
     * @throws ImageException when the bytes do not decode as an image
     */
    public function process(string $bytes): ProcessedImage
    {
        // Intervention already applies the EXIF orientation while decoding and marks the image as aligned, so this
        // call does not rotate twice.
        $jpeg = Image::fromBytes($bytes)
            ->orient()
            ->toJpeg()
            ->quality($this->quality('original_quality'))
            ->toBytes();

        [$width, $height] = $this->dimensions($jpeg);

        return new ProcessedImage(
            jpeg: $jpeg,
            width: $width,
            height: $height,
            variants: $this->variants($jpeg, $width),
            blurhash: $this->blurhash($jpeg, $width, $height),
        );
    }

    /**
     * The configured widths, never upscaled. A smaller photo gets its own width as the largest variant.
     *
     * @return array<int, string>
     */
    private function variants(string $jpeg, int $width): array
    {
        /** @var non-empty-list<int> $configured */
        $configured = config('speedclub.media.variant_widths');

        $widths = array_filter($configured, fn (int $candidate): bool => $candidate <= $width);

        if ($width < max($configured) && ! in_array($width, $widths, true)) {
            $widths[] = $width;
        }

        $variants = [];

        foreach ($widths as $target) {
            $variants[$target] = $this->variant($jpeg, $target);
        }

        return $variants;
    }

    /**
     * One WebP variant of the clean JPEG at the given width. Starts at variant_quality and steps the quality down by
     * variant_quality_step until the bytes fit budgetBytes(), never below variant_min_quality. The dimensions never change: a
     * photo still above its budget at the floor keeps that last, smallest encoding (M4.18, LCP of the public pages).
     */
    public function variant(string $jpeg, int $width): string
    {
        $scaled = Image::fromBytes($jpeg)->scale(width: max(1, $width));
        $budget = $this->budgetBytes($width);
        $quality = $this->quality('variant_quality');
        $floor = min($quality, $this->quality('variant_min_quality'));
        $step = max(1, config()->integer('speedclub.media.variant_quality_step'));

        while (true) {
            $bytes = $scaled->toWebp()->quality($quality)->toBytes();

            if (strlen($bytes) <= $budget || $quality <= $floor) {
                return $bytes;
            }

            $quality = max($floor, min(100, $quality - $step));
        }
    }

    /**
     * Byte budget of a variant of this width. A configured width has its own value. Any other width (a photo narrower than the
     * largest configured one gets its own width as a variant) is scaled from the nearest configured width at or above it, else
     * the largest, by (width ratio) ^ variant_budget_exponent. No configured budget means no limit.
     */
    public function budgetBytes(int $width): int
    {
        /** @var array<int|string, int|float> $configured */
        $configured = config('speedclub.media.variant_budget_kb', []);
        $budgets = [];

        foreach ($configured as $budgetWidth => $kilobytes) {
            $budgets[(int) $budgetWidth] = (float) $kilobytes;
        }

        if ($budgets === []) {
            return PHP_INT_MAX;
        }

        ksort($budgets);

        if (isset($budgets[$width])) {
            return (int) round($budgets[$width] * 1024);
        }

        $reference = max(array_keys($budgets));

        foreach (array_keys($budgets) as $budgetWidth) {
            if ($budgetWidth >= $width) {
                $reference = $budgetWidth;

                break;
            }
        }

        $exponent = config()->float('speedclub.media.variant_budget_exponent');

        return max(1, (int) round($budgets[$reference] * 1024 * (max(1, $width) / max(1, $reference)) ** $exponent));
    }

    private function blurhash(string $jpeg, int $width, int $height): string
    {
        $size = max(1, config()->integer('speedclub.media.blurhash_size'));
        $thumbnail = imagecreatefromstring(Image::fromBytes($jpeg)->scale($size, $size)->toPng()->toBytes());

        if ($thumbnail === false) {
            throw new ImageException('The blurhash thumbnail could not be decoded.');
        }

        $pixels = [];

        for ($y = 0, $rows = imagesy($thumbnail); $y < $rows; $y++) {
            $row = [];

            for ($x = 0, $columns = imagesx($thumbnail); $x < $columns; $x++) {
                $color = (int) imagecolorat($thumbnail, $x, $y);
                $row[] = [($color >> 16) & 0xFF, ($color >> 8) & 0xFF, $color & 0xFF];
            }

            $pixels[] = $row;
        }

        return $width >= $height ? Blurhash::encode($pixels, 4, 3) : Blurhash::encode($pixels, 3, 4);
    }

    /**
     * @return int<1, 100>
     */
    private function quality(string $key): int
    {
        return max(1, min(100, config()->integer('speedclub.media.'.$key)));
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function dimensions(string $jpeg): array
    {
        $size = getimagesizefromstring($jpeg);

        if ($size === false) {
            throw new ImageException('The processed image has no readable dimensions.');
        }

        return [$size[0], $size[1]];
    }
}
