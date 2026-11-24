<?php

namespace App\Http\Controllers\Admin\Spots\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/**
 * ADM-62 "Spot entfernen": moderation.decide and a reason (10–1000 characters, into the audit event `spot.removed`).
 */
class RemoveSpotRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }
}
