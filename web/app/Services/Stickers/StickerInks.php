<?php

namespace App\Services\Stickers;

use App\Enums\StickerColourway;
use App\Enums\StickerMaterial;
use App\Support\DesignTokens;

/**
 * The inks a sticker is printed in and the surfaces it is seen on (m5.4-contract §4, §6). Print inks are not UI colours: the logo
 * exists only in pure white and pure black (design/brand/README.md), Signal-Red is the accent token, and the cut line is the print
 * trade's magenta "CutContour" convention. The surfaces for the Scan-Test and the mock-ups are the canvas tokens: dark glass = the
 * carbon canvas, light paint = the light canvas.
 */
final class StickerInks
{
    public const WHITE = 'white';

    public const BLACK = 'black';

    public const RED = 'red';

    /** QR contrast floor between the dark modules and the light field, on the surface the sticker is made for. */
    public const MIN_CONTRAST = 7.0;

    /**
     * @return array{int, int, int}
     */
    public static function rgb(string $ink): array
    {
        return match ($ink) {
            self::WHITE => [255, 255, 255],
            self::BLACK => [0, 0, 0],
            self::RED => self::token('accent-fill', 'light'),
            default => throw new \InvalidArgumentException("Unknown sticker ink [$ink]."),
        };
    }

    /**
     * The die line in files for the printer.
     *
     * @return array{int, int, int}
     */
    public static function cutContour(): array
    {
        return [236, 0, 140];
    }

    /**
     * What surrounds the sticker where it is stuck: dark glass under white ink, light paint under black ink.
     *
     * @return array{int, int, int}
     */
    public static function surface(StickerColourway $colourway): array
    {
        return $colourway->isWhiteInk() ? self::token('bg-canvas', 'carbon') : self::token('bg-canvas', 'light');
    }

    /**
     * What shows through where nothing is printed inside the die line: the surface, or the vinyl itself.
     *
     * @return array{int, int, int}
     */
    public static function base(StickerColourway $colourway, StickerMaterial $material): array
    {
        return $material === StickerMaterial::WhiteVinyl ? [255, 255, 255] : self::surface($colourway);
    }

    /**
     * Dark modules against the light field as the eye (and a camera) sees them: white ink knocks the modules out of a white field, so
     * they show the dark surface; black ink prints the modules on the light base.
     *
     * @return array{dark: array{int, int, int}, light: array{int, int, int}}
     */
    public static function qrColours(StickerColourway $colourway, StickerMaterial $material): array
    {
        return $colourway->isWhiteInk()
            ? ['dark' => self::base($colourway, $material), 'light' => self::rgb(self::WHITE)]
            : ['dark' => self::rgb(self::BLACK), 'light' => self::base($colourway, $material)];
    }

    /**
     * WCAG contrast ratio of two colours.
     *
     * @param  array{int, int, int}  $a
     * @param  array{int, int, int}  $b
     */
    public static function contrast(array $a, array $b): float
    {
        $la = self::luminance($a);
        $lb = self::luminance($b);

        return (max($la, $lb) + 0.05) / (min($la, $lb) + 0.05);
    }

    /**
     * @param  array{int, int, int}  $rgb
     */
    private static function luminance(array $rgb): float
    {
        $channels = array_map(function (int $value): float {
            $c = $value / 255;

            return $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
        }, $rgb);

        return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
    }

    /**
     * @return array{int, int, int}
     */
    private static function token(string $token, string $theme): array
    {
        [$r, $g, $b] = DesignTokens::rgba($token, $theme);

        return [$r, $g, $b];
    }
}
