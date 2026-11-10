<?php

namespace App\Actions\Admin\Team;

use App\Enums\TeamEvent;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use App\Services\Catalog\Reason;
use App\Services\Team\StaffSessions;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-40 "Alle Sitzungen beenden" (`staff.manage`): another staff member's sessions, remember token and view-as tokens end (credentials
 * epoch, ADR-218/231). Their own sessions staff end on ADM-51 (RevokeOtherOwnSessions). An Owner's only by an Owner.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class RevokeStaffSessions
{
    public function __construct(private readonly StaffSessions $sessions) {}

    public function handle(Staff $by, Staff $target, ?string $reason = null): int
    {
        StaffAtoms::ensure($by, 'staff.manage');
        $reason = Reason::optional($reason);

        if ($by->getKey() === $target->getKey()) {
            throw new TeamRefused('self');
        }

        if ($target->isOwner() && ! $by->isOwner()) {
            throw new TeamRefused('owner_only');
        }

        return DB::transaction(function () use ($by, $target, $reason): int {
            StaffCredentials::rotate($target);
            $ended = $this->sessions->deleteAll($target);

            Audit::record(TeamEvent::SessionsRevoked->value, $target, after: ['sessions_ended' => $ended], reason: $reason, actor: $by);

            return $ended;
        });
    }
}
