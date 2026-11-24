<?php

namespace App\Services\Stickers;

/**
 * Which modules of the QR block get ink, as horizontal runs in module units over the block with its quiet zone. Black ink prints the
 * dark modules on the light base. White ink prints the light modules and the quiet zone and leaves the dark modules out, so they show
 * the dark glass behind: a normal dark-on-light code to a camera, never an inverted one (ADR-027).
 */
final class StickerQrRuns
{
    /**
     * @param  array<string, mixed>  $qr  a `qr` element of StickerArtwork
     * @return list<array{0: int, 1: int, 2: int}> [x, y, length]
     */
    public static function ink(StickerArtwork $artwork, array $qr): array
    {
        /** @var list<list<bool>> $matrix */
        $matrix = $qr['matrix'] ?? [];
        $quiet = StickerCatalogue::QUIET_ZONE_MODULES;
        $count = count($matrix) + 2 * $quiet;
        $inkOnDark = ! $artwork->colourway->isWhiteInk();
        $runs = [];

        for ($y = 0; $y < $count; $y++) {
            $x = 0;

            while ($x < $count) {
                if (self::dark($matrix, $x - $quiet, $y - $quiet) !== $inkOnDark) {
                    $x++;

                    continue;
                }

                $start = $x;

                while ($x < $count && self::dark($matrix, $x - $quiet, $y - $quiet) === $inkOnDark) {
                    $x++;
                }

                $runs[] = [$start, $y, $x - $start];
            }
        }

        return $runs;
    }

    /**
     * @param  list<list<bool>>  $matrix
     */
    private static function dark(array $matrix, int $x, int $y): bool
    {
        return $matrix[$y][$x] ?? false;
    }
}
