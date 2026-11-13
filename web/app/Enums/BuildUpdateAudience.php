<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Who sees a build update (09 §8.5): everybody who may see the vehicle, or only its followers (members following the owner or the
 * vehicle) and the owner.
 */
enum BuildUpdateAudience: string
{
    use HasLabel;

    case Vehicle = 'vehicle';
    case Followers = 'followers';
}
