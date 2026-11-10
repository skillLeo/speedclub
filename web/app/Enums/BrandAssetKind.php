<?php

namespace App\Enums;

/**
 * What a brand asset of ADM-28 is for. Logos keep their transparency (PNG/WebP with alpha); photos are re-encoded as JPEG with WebP
 * variants and a blurhash; the OG default additionally gets its 1200×630 JPEG.
 */
enum BrandAssetKind: string
{
    case WordmarkWhite = 'wordmark_white';
    case WordmarkBlack = 'wordmark_black';
    case Square = 'square';
    case AppMark = 'app_mark';
    case Hero = 'hero';
    case Og = 'og';

    public function isLogo(): bool
    {
        return in_array($this, [self::WordmarkWhite, self::WordmarkBlack, self::Square, self::AppMark], true);
    }

    /**
     * Smallest accepted width and height in pixels.
     *
     * @return array{0: int, 1: int}
     */
    public function minimum(): array
    {
        return match ($this) {
            self::Hero => [1080, 1080],
            self::Og => [1200, 630],
            self::Square, self::AppMark => [512, 512],
            self::WordmarkWhite, self::WordmarkBlack => [640, 64],
        };
    }
}
