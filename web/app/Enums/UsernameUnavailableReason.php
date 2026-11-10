<?php

namespace App\Enums;

/**
 * Why a username cannot be used. A name in somebody's 14-day window or held by a deleted account reads as taken, so the
 * answer says no more than availability.
 */
enum UsernameUnavailableReason: string
{
    case Length = 'length';
    case Characters = 'characters';
    case Start = 'start';
    case TrailingDot = 'trailing_dot';
    case ConsecutiveDots = 'consecutive_dots';
    case Reserved = 'reserved';
    case Taken = 'taken';
}
