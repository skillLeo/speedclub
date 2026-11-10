<?php

namespace App\Services\Qr;

use App\Enums\QrScanState;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Support\Codes;
use Illuminate\Support\Facades\Gate;

/**
 * Revoked comes first, for the owner too: it protects a sold car, and a sticker on it must never lead anywhere. A code whose vehicle
 * the viewer may not see reads "privat" whatever the reason, so a stranger cannot tell a suspended owner or a block from a
 * vehicle set to private (ADR-141). The hard delete of a vehicle leaves its codes behind as tombstones without a vehicle, so a
 * sticker reads as revoked ("nicht mehr verfügbar", QrResolution::copy) for good, and no new vehicle can ever get its code.
 */
class QrResolver
{
    public function resolve(string $input, ?User $viewer): QrResolution
    {
        $code = Codes::normalize($input);
        $qr = $code === null ? null : QrCode::query()->where('code', $code)->first();

        if ($qr === null) {
            return new QrResolution(QrScanState::NotFound);
        }

        return new QrResolution($this->stateOf($qr, $viewer), $qr, $qr->vehicle);
    }

    /**
     * For a scan that leads to a page showing a signed-in browser what it shows a guest: live only when the viewer and a guest may
     * both see the vehicle. So the owner of a private vehicle reads "privat" instead of reaching a 404, and a block still holds.
     */
    public function resolveForGuestPage(string $input, ?User $viewer): QrResolution
    {
        $resolution = $this->resolve($input, $viewer);

        if ($viewer === null || $resolution->qr === null || $resolution->state !== QrScanState::Active) {
            return $resolution;
        }

        return new QrResolution($this->stateOf($resolution->qr, null), $resolution->qr, $resolution->vehicle);
    }

    public function stateOf(QrCode $qr, ?User $viewer): QrScanState
    {
        /** @var Vehicle|null $vehicle */
        $vehicle = $qr->vehicle;

        return match (true) {
            $qr->status === QrStatus::Revoked, $vehicle === null, $vehicle->trashed() => QrScanState::Revoked,
            $vehicle->status === VehicleStatus::Draft => QrScanState::NotFound,
            Gate::forUser($viewer)->allows('view', $vehicle) => QrScanState::Active,
            default => QrScanState::Private,
        };
    }
}
