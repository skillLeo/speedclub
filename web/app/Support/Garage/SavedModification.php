<?php

namespace App\Support\Garage;

use App\Models\Modification;

/**
 * What an edit of a modification left behind: the row, and whether Verlauf now tells about the edit (BuildUpdates).
 */
final readonly class SavedModification
{
    public function __construct(
        public Modification $modification,
        public bool $historyRecorded,
    ) {}
}
