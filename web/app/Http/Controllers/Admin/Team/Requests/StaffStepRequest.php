<?php

namespace App\Http\Controllers\Admin\Team\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-40 deactivate, reactivate, delete, second-factor reset (`staff.manage`, with reason 10–1000). */
class StaffStepRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'staff.manage';
    }
}
