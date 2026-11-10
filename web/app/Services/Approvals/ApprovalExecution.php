<?php

namespace App\Services\Approvals;

use App\Models\ApprovalRequest;
use App\Models\Staff;

/**
 * The request Approvals::approve() is executing right now and the staff member who approved it (MF-1 of the M3.1 review, SEC-P3-10).
 * Only approve() creates one (Approvals::executing()); the four-eyes executors check against it (FourEyes).
 */
final readonly class ApprovalExecution
{
    public function __construct(
        public ApprovalRequest $request,
        public Staff $approver,
    ) {}
}
