<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum Gearbox: string
{
    use HasLabel;

    case Manual = 'manual';
    case Automatic = 'automatic';
    case DualClutch = 'dual_clutch';
    case Sequential = 'sequential';
    case Cvt = 'cvt';
    case SingleSpeed = 'single_speed';
}
