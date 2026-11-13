<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Who sees an event (09 §8.7): public (listed for everybody), followers (the organiser's followers, not listed for others) or unlisted
 * (by link only, never listed).
 */
enum EventVisibility: string
{
    use HasLabel;

    case Public = 'public';
    case Followers = 'followers';
    case Unlisted = 'unlisted';
}
