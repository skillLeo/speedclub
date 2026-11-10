<?php

namespace App\Actions\Admin\Qr;

use App\Enums\AdminMemberEvent;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Models\QrCode;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Qr\QrCodes;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-19 "Neu ausgeben" (`qr.revoke`, recent password, reason): the vehicle's active code (if any) is revoked as `reissued` and a new
 * one becomes the only active code (QrCodes, the same steps as the owner's ReissueQrCode, under the vehicle's lock); this is also the
 * way back from a staff takedown. Only for a published vehicle that is not deleted. The owner is mailed. Audited `qr.reissued_by_staff`
 * with both codes.
 *
 * @throws AuthorizationException|DomainException
 */
class ReissueQrCodeAsStaff
{
    public function __construct(
        private readonly QrCodes $codes,
        private readonly RevokeQrCode $revoke,
    ) {}

    public function handle(Staff $staff, QrCode $qr, string $reason): QrCode
    {
        StaffAtoms::ensure($staff, 'qr.revoke');

        [$vehicle, $new] = DB::transaction(function () use ($staff, $qr, $reason): array {
            $vehicle = $qr->vehicle_id === null ? null : Vehicle::query()->whereKey($qr->vehicle_id)->lockForUpdate()->first();

            if (! $vehicle instanceof Vehicle || $vehicle->status !== VehicleStatus::Published) {
                throw new DomainException('Only a published vehicle gets a new code.');
            }

            $previous = $vehicle->qrCodes()->where('status', QrStatus::Active)->value('code');
            $this->codes->revoke($vehicle, QrRevocationReason::Reissued);
            $new = $this->codes->ensureActive($vehicle);

            Audit::record(AdminMemberEvent::QrReissued->value, $vehicle, ['code' => $previous], ['code' => $new->code, 'from_qr_id' => $qr->getKey()], trim($reason), $staff);

            return [$vehicle, $new];
        });

        $this->revoke->tellOwner($vehicle, 'reissued');

        return $new;
    }
}
