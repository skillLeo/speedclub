<?php

namespace App\Actions\Crews\Staff;

use App\Actions\Moderation\DecideCase;
use App\Enums\CrewAuditEvent;
use App\Enums\CrewStatus;
use App\Enums\DecisionAction;
use App\Models\Crew;
use App\Models\Decision;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use App\Services\Moderation\Statement;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-80/81 "Ausblenden" (contract-crews.md C6, `moderation.decide`): a remove_content decision on the crew (its open case, or a new
 * own-initiative one). ContentRemoval → CrewModeration sets it hidden: out of every list and page but its own members'; the founder gets
 * the statement of reasons (DecideCase, audited moderation.decided; crew.hidden as well, for the crew's own timeline).
 *
 * @throws AuthorizationException|DomainException when it is not active
 */
class HideCrew
{
    public function __construct(private readonly DecideCase $decide, private readonly OwnInitiativeCases $cases) {}

    public function handle(Staff $staff, Crew $crew, Statement $statement, string $reason): Decision
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        if ($crew->trashed() || $crew->status !== CrewStatus::Active) {
            throw new DomainException('The crew is not active.');
        }

        return DB::transaction(function () use ($staff, $crew, $statement, $reason): Decision {
            $decision = $this->decide->handle($this->cases->forTarget($crew, $staff), new DecisionInput(
                action: DecisionAction::RemoveContent,
                facts: $statement->facts,
                ground: $statement->ground,
                groundDocument: $statement->groundDocument,
                groundSection: $statement->groundSection,
                decidedBy: $staff,
                reason: trim($reason),
            ));
            Audit::record(CrewAuditEvent::Hidden->value, $crew, ['status' => CrewStatus::Active->value], ['status' => CrewStatus::Hidden->value, 'decision_id' => $decision->id], trim($reason), $staff);

            return $decision;
        });
    }
}
