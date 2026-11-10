<?php

namespace App\Http\Controllers\Admin\Team\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-40 "Alle Sitzungen beenden" (`staff.manage`): the reason is optional here. */
class StaffSessionsRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'staff.manage';
    }

    public function rules(): array
    {
        return ['reason' => ['nullable', 'string', 'min:10', 'max:1000']];
    }
}
