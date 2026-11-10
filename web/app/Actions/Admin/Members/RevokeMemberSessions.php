<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Enums\SecurityNotice;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Auth\MemberSessions;
use App\Services\Notifications\Notifier;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-10 "Alle Sitzungen beenden" (`members.revoke_sessions`, recent password): every token (view-as ones included), browser session,
 * push token and signed link of the account end (MemberSessions::revokeAll, SEC-P2-02); the member gets the sessions_revoked security
 * notice in its staff wording. Also the bulk action of ADM-09.
 *
 * @return array{devices: int, sessions: int}
 *
 * @throws AuthorizationException
 */
class RevokeMemberSessions
{
    public function __construct(
        private readonly MemberSessions $sessions,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @return array{devices: int, sessions: int}
     */
    public function handle(Staff $staff, User $member, string $reason): array
    {
        StaffAtoms::ensure($staff, 'members.revoke_sessions');

        $revoked = DB::transaction(function () use ($staff, $member, $reason): array {
            User::withTrashed()->whereKey($member->id)->lockForUpdate()->value('id');
            $revoked = $this->sessions->revokeAll($member);

            Audit::record(AdminMemberEvent::SessionsRevokedByStaff->value, $member, after: $revoked, reason: trim($reason), actor: $staff);

            return $revoked;
        });

        if (! $member->isDeactivated()) {
            $this->notifier->security($member, SecurityNotice::SessionsRevoked, variant: 'staff');
        }

        return $revoked;
    }
}
