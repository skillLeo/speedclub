<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * The kind of a meet (09 §8.7, EVT-01 filter "Art"): Treffen · Ausfahrt · Trackday · Messe.
 */
enum EventType: string
{
    use HasLabel;

    case Meet = 'meet';
    case Cruise = 'cruise';
    case TrackDay = 'track_day';
    case Show = 'show';
}
