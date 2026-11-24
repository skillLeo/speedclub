<?php

namespace App\Services\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Staff;

/**
 * The request Approvals::approve() is executing right now and the staff member who approved it (MF-1 of the M3.1 review, SEC-P3-10).
 * Only approve() and overrideByOwner() create one (Approvals::executing()); the four-eyes executors check against it (FourEyes).
 * `ownerOverride`: ADR-507, the requesting Owner executes their own request because no second eligible approver exists (approver ===
 * requester); the executor rule of FourEyes accepts that only for OwnerOverride::ACTIONS. `direct`: ADR-540, four-eyes is off and the
 * requester executes their own request at once (Approvals::direct(), approver === requester).
 */
final readonly class ApprovalExecution
{
    public function __construct(
        public ApprovalRequest $request,
        public Staff $approver,
        public bool $ownerOverride = false,
        public bool $direct = false,
    ) {}
}
