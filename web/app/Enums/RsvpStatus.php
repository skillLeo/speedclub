<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * A member's answer to an event (09 §8.7): going ("Zusagen"), interested, or the waitlist when a capacity is full. A spot that frees up
 * goes to the longest-waiting member (Rsvps::fill).
 */
enum RsvpStatus: string
{
    use HasLabel;

    case Going = 'going';
    case Interested = 'interested';
    case Waitlist = 'waitlist';
}
