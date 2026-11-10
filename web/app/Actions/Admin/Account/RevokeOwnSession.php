<?php

namespace App\Actions\Admin\Account;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use App\Services\Team\StaffSessions;
use App\Services\Team\TeamRefused;
use Illuminate\Contracts\Session\Session;
use Illuminate\Support\Facades\DB;

/**
 * ADM-51 sessions: end one other session of the staff member's own account (by its handle), or every other one. Signing out only takes
 * access away, so no password is asked (as ADR-209 a for members). This session stays: sign-out is the way to end it.
 *
 * @throws TeamRefused current_session, session_unknown
 */
class RevokeOwnSession
{
    public function __construct(private readonly StaffSessions $sessions) {}

    public function handle(Staff $staff, string $handle, Session $current): void
    {
        if (hash_equals(StaffSessions::handle($current->getId()), $handle)) {
            throw new TeamRefused('current_session');
        }

        if (! $this->sessions->revoke($staff, $handle)) {
            throw new TeamRefused('session_unknown');
        }

        Audit::record(StaffSecurityEvent::OwnSessionRevoked->value, $staff, after: ['scope' => 'one'], actor: $staff);
    }

    /**
     * Every other session ends: rows deleted, credentials epoch moved (also for drivers without rows), this session keeps the new epoch.
     */
    public function others(Staff $staff, Session $current): int
    {
        return DB::transaction(function () use ($staff, $current): int {
            StaffCredentials::rotate($staff, $current);
            $ended = $this->sessions->deleteAll($staff, $current->getId());

            Audit::record(StaffSecurityEvent::OwnSessionRevoked->value, $staff, after: ['scope' => 'others', 'sessions_ended' => $ended], actor: $staff);

            return $ended;
        });
    }
}
