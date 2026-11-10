<?php

namespace App\Http\Controllers\Admin\Team\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-41 "Rolle löschen" (`roles.manage`, with reason). */
class DeleteRoleRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'roles.manage';
    }
}
