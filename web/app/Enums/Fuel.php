<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum Fuel: string
{
    use HasLabel;

    case Petrol = 'petrol';
    case Diesel = 'diesel';
    case Hybrid = 'hybrid';
    case PlugInHybrid = 'plug_in_hybrid';
    case Electric = 'electric';
    case Lpg = 'lpg';
    case Cng = 'cng';
    case Ethanol = 'ethanol';
    case Other = 'other';
}
