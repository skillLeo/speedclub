<?php

namespace App\Http\Controllers\Admin\Qr\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-19 revoke / reissue: `qr.revoke` and a reason. */
class QrChangeRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'qr.revoke';
    }
}
