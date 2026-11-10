<?php

namespace App\Actions\Admin\Vehicles;

use App\Actions\Moderation\DecideCase;
use App\Enums\DecisionAction;
use App\Enums\ReportTargetType;
use App\Models\Decision;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\ModerationHolds;
use App\Services\Moderation\OwnInitiativeCases;
use App\Services\Moderation\Statement;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-12 "Ausblenden" (`vehicles.hide`, recent password): a remove_content decision on the vehicle (m3.2-contract §1), on its open case
 * or a new own-initiative one. ContentRemoval sets it private under a moderation hold the owner cannot lift, takes it out of search and
 * purges its share images and sitemap entry (ADR-204 c, ADR-207); the owner gets the statement of reasons. Audited as
 * `moderation.decided`. Also the step of the vehicle bulk hide.
 *
 * @throws AuthorizationException|DomainException when it is hidden already
 */
class HideVehicle
{
    public function __construct(
        private readonly DecideCase $decide,
        private readonly OwnInitiativeCases $cases,
        private readonly ModerationHolds $holds,
    ) {}

    public function handle(Staff $staff, Vehicle $vehicle, Statement $statement, string $reason): Decision
    {
        StaffAtoms::ensure($staff, 'vehicles.hide');

        if ($vehicle->trashed()) {
            throw new DomainException('The vehicle is deleted.');
        }

        return DB::transaction(function () use ($staff, $vehicle, $statement, $reason): Decision {
            $case = $this->cases->forTarget($vehicle, $staff);

            if ($case->isOwnInitiative() && $case->wasRecentlyCreated && $this->holds->activeRemoval(ReportTargetType::Vehicle, $vehicle->id) !== null) {
                throw new DomainException('The vehicle is hidden already.');
            }

            return $this->decide->handle($case, new DecisionInput(
                action: DecisionAction::RemoveContent,
                facts: $statement->facts,
                ground: $statement->ground,
                groundDocument: $statement->groundDocument,
                groundSection: $statement->groundSection,
                decidedBy: $staff,
                reason: trim($reason),
            ));
        });
    }
}
