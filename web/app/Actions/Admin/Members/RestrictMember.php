<?php

namespace App\Actions\Admin\Members;

use App\Actions\Moderation\DecideCase;
use App\Enums\DecisionAction;
use App\Enums\RestrictionType;
use App\Models\Decision;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use App\Services\Moderation\Statement;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * ADM-10 "Einschränken" (`members.restrict`, recent password): messaging or publishing, until a date or without an end. A DSA decision
 * (m3.2-contract §1) on the member's open case, or on a new own-initiative case: the member gets the statement of reasons in the app,
 * by an urgent push and by e-mail (DecideCase), and may appeal. Audited as `moderation.decided` with the staff member and reason.
 *
 * @throws AuthorizationException|InvalidArgumentException
 */
class RestrictMember
{
    public function __construct(
        private readonly DecideCase $decide,
        private readonly OwnInitiativeCases $cases,
    ) {}

    public function handle(Staff $staff, User $member, RestrictionType $type, ?CarbonImmutable $until, Statement $statement, string $reason): Decision
    {
        StaffAtoms::ensure($staff, 'members.restrict');

        if ($member->trashed() || $member->isDeactivated()) {
            throw new InvalidArgumentException('There is no account to restrict.');
        }

        return DB::transaction(fn (): Decision => $this->decide->handle($this->cases->forTarget($member, $staff), new DecisionInput(
            action: DecisionAction::Restrict,
            facts: $statement->facts,
            ground: $statement->ground,
            groundDocument: $statement->groundDocument,
            groundSection: $statement->groundSection,
            restriction: $type,
            until: $until,
            decidedBy: $staff,
            reason: trim($reason),
        )));
    }
}
