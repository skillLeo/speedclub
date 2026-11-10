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
            $variants[$target] = Image::fromBytes($jpeg)
                ->scale(width: max(1, $target))
                ->toWebp()
                ->quality($this->quality('variant_quality'))
                ->toBytes();
        }

        return $variants;
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
