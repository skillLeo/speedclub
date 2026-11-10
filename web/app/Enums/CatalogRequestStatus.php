<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum CatalogRequestStatus: string
{
    use HasLabel;

    case Pending = 'pending';
    case Approved = 'approved';
    case Rejected = 'rejected';
}
