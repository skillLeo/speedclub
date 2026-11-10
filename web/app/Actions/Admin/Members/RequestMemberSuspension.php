<?php

namespace App\Actions\Admin\Members;

use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Moderation\Statement;
use App\Services\Moderation\SuspensionLimit;
use App\Support\Moderation\ModerationText;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-10 "Sperren" (`members.suspend`, four-eyes, recent password): never executes here. Asks for the approval of
 * `moderation.suspend` with the member as subject (one pending suspension per member); on approval the handler decides an
 * own-initiative case (or the member's open case) through DecideCase, with this staff member as decider and the approver recorded.
 * A moderator suspends for at most 30 days (06_ADMIN_SPEC §2), checked here and again at execution.
 *
 * @throws AuthorizationException|ValidationException
 */
class RequestMemberSuspension
{
    public function __construct(private readonly Approvals $approvals) {}

    public function handle(Staff $staff, User $member, ?CarbonImmutable $until, Statement $statement, string $reason): ApprovalRequest
    {
        StaffAtoms::ensure($staff, 'members.suspend');

        if (! SuspensionLimit::allows($staff, $until)) {
            throw ValidationException::withMessages(['until' => [(string) __('moderation.suspension_limit', [
                'days' => SuspensionLimit::MODERATOR_MAX_DAYS,
                'date' => ModerationText::date(SuspensionLimit::latestEnd()),
            ])]]);
        }

        return $this->approvals->request('moderation.suspend', [
            'member_id' => $member->id,
            ...$statement->toArray(),
            'until' => $until?->toIso8601String(),
        ], $reason, $staff, $member);
    }
}
