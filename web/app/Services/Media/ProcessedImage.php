<?php

namespace App\Services\Media;

/**
 * Output of the image pipeline: nothing here carries metadata of the source file.
 */
final readonly class ProcessedImage
{
    /**
     * @param  array<int, string>  $variants  WebP bytes by real pixel width
     */
    public function __construct(
        public string $jpeg,
        public int $width,
        public int $height,
        public array $variants,
        public string $blurhash,
    ) {}
}
