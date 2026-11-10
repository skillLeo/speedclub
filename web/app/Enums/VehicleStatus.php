<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum VehicleStatus: string
{
    use HasLabel;

    case Draft = 'draft';
    case Published = 'published';
    case Archived = 'archived';
}
