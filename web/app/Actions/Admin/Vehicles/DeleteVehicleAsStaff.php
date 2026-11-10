<?php

namespace App\Actions\Admin\Vehicles;

use App\Actions\Garage\DeleteVehicle;
use App\Actions\Moderation\DecideCase;
use App\Enums\AdminMemberEvent;
use App\Enums\DecisionAction;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use App\Services\Moderation\Statement;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-12 "Löschen" (`vehicles.delete`, recent password; the controller checks the typed "LÖSCHEN"): a removal is a restriction of
 * content (Art. 17 DSA, 08_LEGAL_COMPLIANCE §4), so the owner is told through a remove_content decision with the statement of reasons
 * (the "owner mailed" of ADM-12) before the member's own delete path runs: DeleteVehicle (soft delete, QR revoked, out of search, a
 * main vehicle hands over) with DeleteAllMedia (public files gone, ADR-123); vehicles:prune hard-deletes after 30 days. Audited
 * `vehicle.deleted_by_staff` as well.
 *
 * @throws AuthorizationException|DomainException
 */
class DeleteVehicleAsStaff
{
    public function __construct(
        private readonly DecideCase $decide,
        private readonly OwnInitiativeCases $cases,
        private readonly DeleteVehicle $delete,
    ) {}

    public function handle(Staff $staff, Vehicle $vehicle, Statement $statement, string $reason): void
    {
        StaffAtoms::ensure($staff, 'vehicles.delete');

        $owner = User::withTrashed()->find($vehicle->owner_id);

        if ($vehicle->trashed() || ! $owner instanceof User) {
            throw new DomainException('The vehicle is deleted already.');
        }

        // One transaction in the ADR-225 order (SF-7): the decision, then the member's own delete path, then the event. If any of it
        // fails nothing stands, and the owner is not told (DecideCase and DeleteVehicle remove files and notify after the commit).
        DB::transaction(function () use ($staff, $vehicle, $owner, $statement, $reason): void {
            $decision = $this->decide->handle($this->cases->forTarget($vehicle, $staff), new DecisionInput(
                action: DecisionAction::RemoveContent,
                facts: $statement->facts,
                ground: $statement->ground,
                groundDocument: $statement->groundDocument,
                groundSection: $statement->groundSection,
                decidedBy: $staff,
                reason: trim($reason),
            ));

            $this->delete->handle($owner, $vehicle);

            Audit::record(AdminMemberEvent::VehicleDeleted->value, $vehicle, after: ['decision_id' => $decision->id, 'owner_id' => $owner->id], reason: trim($reason), actor: $staff);
        });
    }
}
