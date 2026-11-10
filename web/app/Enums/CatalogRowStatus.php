<?php

namespace App\Enums;

/**
 * One CSV row of a dry run or an apply (ADM-17 diff table): new entry, changed entry, nothing to do, or refused with a reason.
 * Labels live with the admin page (lang/admin/<locale>/catalog.json).
 */
enum CatalogRowStatus: string
{
    case New = 'new';
    case Changed = 'changed';
    case Unchanged = 'unchanged';
    case Error = 'error';

    public function changes(): bool
    {
        return $this === self::New || $this === self::Changed;
    }
}
