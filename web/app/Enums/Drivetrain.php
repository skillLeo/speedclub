<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum Drivetrain: string
{
    use HasLabel;

    case Front = 'front';
    case Rear = 'rear';
    case All = 'all';
}
