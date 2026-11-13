<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * SET-11 "Gewicht" (09 §8.11): how the app shows weights. The server stores kilograms only.
 */
enum WeightUnit: string
{
    use HasLabel;

    case Kg = 'kg';
    case Lb = 'lb';
}
