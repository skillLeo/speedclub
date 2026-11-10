<?php

namespace App\Actions\Admin\Members;

use App\Actions\Moderation\ReverseDecision;
use App\Enums\DecisionRestriction;
use App\Models\Decision;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * ADM-10 "Aufheben" (`members.restrict`; a suspension also needs `members.suspend`): a `reverse` decision on the decision the account
 * holds the restriction for (users.restrictions.<type>.decision_id). The member is told in the app and by e-mail; audited as
 * `moderation.decided` (action reverse). $facts is what the member reads, $reason the audit reason.
 *
 * @throws AuthorizationException|DomainException when the account holds no such restriction from a decision
 */
class LiftRestriction
{
    public function __construct(private readonly ReverseDecision $reverse) {}

    public function handle(Staff $staff, User $member, DecisionRestriction $type, string $facts, string $reason): Decision
    {
        StaffAtoms::ensure($staff, ...($type === DecisionRestriction::Suspension ? ['members.restrict', 'members.suspend'] : ['members.restrict']));

        $restrictions = is_array($member->restrictions) ? $member->restrictions : [];
        $decisionId = $restrictions[$type->value]['decision_id'] ?? null;
        $decision = is_string($decisionId) ? Decision::query()->find($decisionId) : null;

        if (! $decision instanceof Decision) {
            throw new DomainException('The account holds no such restriction from a decision.');
        }

        return $this->reverse->handle($decision, $staff, $facts, trim($reason));
    }
}
