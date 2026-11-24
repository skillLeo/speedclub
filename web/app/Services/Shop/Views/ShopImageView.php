<?php

namespace App\Services\Shop\Views;

/**
 * One shop photo as the member API shows it (m5.5-contract §3.4): public WebP variants only, never the private original.
 */
final readonly class ShopImageView
{
    /**
     * @param  list<array{width: int, height: int, url: string}>  $variants  smallest first
     */
    public function __construct(
        public string $id,
        public int $width,
        public int $height,
        public string $aspect,
        public string $blurhash,
        public ?string $thumbhash,
        public float $focalX,
        public float $focalY,
        public ?string $alt,
        public array $variants,
    ) {}
}
