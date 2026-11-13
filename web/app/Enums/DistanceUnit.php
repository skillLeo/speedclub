<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * SET-11 "Entfernung" (09 §8.11): how the app shows distances and mileage. The server stores kilometres only.
 */
enum DistanceUnit: string
{
    use HasLabel;

    case Km = 'km';
    case Mi = 'mi';
}
