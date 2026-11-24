<?php

namespace App\Services\Stickers;

use App\Support\BrandFiles;
use RuntimeException;

/**
 * The client's wide logo in pure white or pure black, the largest file the brand script writes into
 * web/ (public/brand/logo-wide-*-1280.png from design/brand). Never redrawn, recoloured or cut (design/brand/README.md). OA-3: when the
 * vector originals arrive, the brand script should write print masters here.
 */
final class StickerLogo
{
    /** @var array<string, string> */
    private static array $bytes = [];

    public static function file(string $ink): string
    {
        return public_path('brand/logo-wide-'.($ink === StickerInks::BLACK ? 'black' : 'white').'-1280.png');
    }

    /**
     * The on-screen file the preview SVG links to, so a live preview stays small; with its content hash, so a new logo is never
     * answered from a cache (BrandFiles).
     */
    public static function url(string $ink): string
    {
        return BrandFiles::url('brand/logo-wide-'.($ink === StickerInks::BLACK ? 'black' : 'white').'-640.png');
    }

    public static function png(string $ink): string
    {
        if (isset(self::$bytes[$ink])) {
            return self::$bytes[$ink];
        }

        $bytes = @file_get_contents(self::file($ink));

        if ($bytes === false) {
            throw new RuntimeException('The logo file for the sticker is missing: run the brand script.');
        }

        return self::$bytes[$ink] = $bytes;
    }
}
