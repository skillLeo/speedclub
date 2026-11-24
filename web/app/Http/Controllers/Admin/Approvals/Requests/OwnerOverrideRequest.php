<?php

namespace App\Http\Controllers\Admin\Approvals\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Models\Staff;

/**
 * "Selbst freigeben (Owner-Override)" ⚿ (ADR-507): an active Owner with a reason (10–1000, into `approval.owner_override` and the mail
 * to every Owner). Whether this request may be overridden (own request, publishing action, no second eligible approver, governance
 * switch on, cool-down, snapshot) is the engine's decision (OwnerOverride), never the page's.
 */
class OwnerOverrideRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'approvals.decide';
    }

    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return parent::authorize() && $staff instanceof Staff && $staff->isActive() && $staff->isOwner();
    }
}
