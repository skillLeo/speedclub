<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-10 "2FA zurücksetzen" (four-eyes, recent password). */
class ResetTwoFactorRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.reset_2fa';
    }
}
