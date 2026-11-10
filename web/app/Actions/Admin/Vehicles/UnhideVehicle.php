<?php

namespace App\Actions\Admin\Vehicles;

use App\Actions\Moderation\ReverseDecision;
use App\Enums\ReportTargetType;
use App\Models\Decision;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Moderation\ModerationHolds;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * ADM-12 "Einblenden" (`vehicles.hide`, recent password): a `reverse` decision on the newest removal of the vehicle that is still in
 * force. The hold ends, and the vehicle gets back the visibility it had while the owner kept it private (ContentRestoration); the owner
 * is told why. $facts is what the owner reads, $reason the audit reason.
 *
 * @throws AuthorizationException|DomainException when nothing hides it
 */
class UnhideVehicle
{
    public function __construct(
        private readonly ReverseDecision $reverse,
        private readonly ModerationHolds $holds,
    ) {}

    public function handle(Staff $staff, Vehicle $vehicle, string $facts, string $reason): Decision
    {
        StaffAtoms::ensure($staff, 'vehicles.hide');

        $removal = $this->holds->activeRemoval(ReportTargetType::Vehicle, $vehicle->id)
            ?? throw new DomainException('No decision hides this vehicle.');

        return $this->reverse->handle($removal, $staff, $facts, trim($reason));
    }
}
