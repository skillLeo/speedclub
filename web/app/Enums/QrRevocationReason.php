<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum QrRevocationReason: string
{
    use HasLabel;

    case Reissued = 'reissued';
    case VehicleDeleted = 'vehicle_deleted';
    case AccountDeleted = 'account_deleted';
    case Moderation = 'moderation';
}
