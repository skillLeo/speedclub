<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-10 "Abzeichen entziehen" (SEC-P5G-05): moderation.decide and a reason (10–1000, into the audit event). */
class RevokeBadgeRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }
}
