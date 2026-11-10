<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-10 "Export" (four-eyes). */
class ExportMemberRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.export';
    }
}
