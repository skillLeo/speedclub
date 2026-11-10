<?php

namespace App\Actions\Moderation;

use App\Enums\DecisionAction;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\Staff;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use DomainException;
use Illuminate\Support\Facades\DB;

/**
 * The `reverse` decision (m3.2-contract §1): staff lift a restriction or a suspension, or bring back hidden content, and an upheld appeal
 * (M3.4) does the same. Recorded through DecideCase on a case of its own (OwnInitiativeCases::forReversal), naming the decision it
 * lifts; a decision is reversed at most once. $facts is what the member reads (why the measure ends), $reason the audit reason. The
 * caller checks the staff member's atom; DecideCase audits `moderation.decided` with action reverse.
 *
 * @throws DomainException when there is nothing (left) to reverse
 */
class ReverseDecision
{
    public function __construct(
        private readonly DecideCase $decide,
        private readonly OwnInitiativeCases $cases,
    ) {}

    public function handle(Decision $decision, Staff $by, string $facts, string $reason, ?Appeal $appeal = null): Decision
    {
        return DB::transaction(function () use ($decision, $by, $facts, $reason, $appeal): Decision {
            // M3.4: an overturned appeal names itself on the reversal's case, so its appellant and the original reporters hear of it.
            $case = $this->cases->forReversal($decision, $by, $appeal);

            return $this->decide->handle($case, new DecisionInput(
                action: DecisionAction::Reverse,
                facts: $facts,
                ground: '',
                groundDocument: $decision->groundDocument(),
                decidedBy: $by,
                reason: $reason,
                reverses: $decision,
            ));
        });
    }
}
