<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-10 "Alle Sitzungen beenden" (recent password). */
class RevokeSessionsRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.revoke_sessions';
    }
}
