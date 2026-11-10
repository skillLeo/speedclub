<?php

namespace App\Services\Approvals;

/**
 * A handler whose payload decides which further atoms requester and approver need besides atom(), e.g. the member bulk action
 * (M3.2): revoking sessions of 300 members needs members.revoke_sessions, deleting them members.delete. Approvals checks these at the
 * request, in pendingFor() and before execution, exactly like atom().
 */
interface ChecksPayloadAtoms
{
    /**
     * @param  array<string, mixed>  $payload
     * @return list<string>
     */
    public function atomsFor(array $payload): array;
}
