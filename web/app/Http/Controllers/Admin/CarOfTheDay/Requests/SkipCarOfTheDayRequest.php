<?php

namespace App\Http\Controllers\Admin\CarOfTheDay\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-64 "Tag aussetzen": content.edit and a reason (10–1000, stored on the day and in the audit event). */
class SkipCarOfTheDayRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'content.edit';
    }
}
