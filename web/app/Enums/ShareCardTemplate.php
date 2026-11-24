<?php

namespace App\Enums;

/**
 * R5-2e VEH-07 2.0 (12_CLIENT_ROUND_5 "share card contract"): the layout of a share card. `band` is the card as before (square: photo on
 * top, band below; story: photo edge to edge, data at the bottom); `poster` the photo edge to edge on both formats under a dark scrim,
 * always dark; `frame` the photo inset on a solid ground with a caption block, in the chosen theme.
 */
enum ShareCardTemplate: string
{
    case Band = 'band';
    case Poster = 'poster';
    case Frame = 'frame';

    /** Whether `theme` changes this template on $format (square band, both frame formats). */
    public function takesTheme(string $format): bool
    {
        return $this === self::Frame || ($this === self::Band && $format === 'square');
    }
}
