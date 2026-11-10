<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-10 "Reset-Link senden". */
class SendResetLinkRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.reset_password';
    }
}
