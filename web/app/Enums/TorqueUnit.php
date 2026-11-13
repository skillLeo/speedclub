<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * SET-11 "Drehmoment" (09 §8.11): how the app shows torque. The server stores newton metres only.
 */
enum TorqueUnit: string
{
    use HasLabel;

    case Nm = 'nm';
    case LbFt = 'lbft';
}
