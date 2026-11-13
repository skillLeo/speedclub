<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Where an item stands (MNT-01 ring and countdown): nothing due known, fine, inside its first lead time (or 1,000 km), or past due.
 */
enum MaintenanceDueState: string
{
    use HasLabel;

    case Unknown = 'unknown';
    case Ok = 'ok';
    case Soon = 'soon';
    case Overdue = 'overdue';
}
