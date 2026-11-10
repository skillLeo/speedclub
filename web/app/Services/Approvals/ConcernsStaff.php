<?php

namespace App\Services\Approvals;

use App\Models\Staff;

/**
 * A handler whose payload can be about a staff member without naming them as `staff_id` (ADR-237: the staff member a request is about
 * can never approve it). roles.sensitive_atoms names roles: whoever holds a role that the change gives atoms to would approve their own
 * elevation (SF-3 of the M3.4-batch review). Approvals reads the payload of these handlers for every approver, like ChecksPayloadAtoms.
 */
interface ConcernsStaff
{
    /**
     * @param  array<string, mixed>  $payload
     */
    public function concerns(array $payload, Staff $staff): bool;
}
