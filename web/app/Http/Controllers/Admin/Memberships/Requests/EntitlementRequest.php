<?php

namespace App\Http\Controllers\Admin\Memberships\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-F2 grant (`memberships.manage`, with reason): member (@username), plan, start, optional end; revoke needs only the reason. */
class EntitlementRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'memberships.manage';
    }

    protected function extraRules(): array
    {
        return $this->routeIs('admin.memberships.entitlements.store') ? [
            'member' => ['required', 'string', 'max:40'],
            'plan_id' => ['required', 'integer'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date'],
        ] : [];
    }
}
