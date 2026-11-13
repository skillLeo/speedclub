<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * 09 §8.7: the exact place is public, or only for the organiser and members with a confirmed RSVP ("going"); everybody else sees the
 * area (city and a coarse point), never the venue, address or exact coordinates.
 */
enum EventLocationVisibility: string
{
    use HasLabel;

    case Public = 'public';
    case AfterRsvp = 'after_rsvp';
}
