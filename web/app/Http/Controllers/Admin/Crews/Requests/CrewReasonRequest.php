<?php

namespace App\Http\Controllers\Admin\Crews\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-81 "Löschen" and "Wiederherstellen" (recent password): a reason for the audit log; the Staff action checks the atom again. */
class CrewReasonRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }
}
