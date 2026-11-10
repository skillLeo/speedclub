<?php

namespace App\Actions\Admin\Qr;

use App\Enums\AdminMemberEvent;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Mail\QrCodeChangedByStaffMail;
use App\Models\QrCode;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Garage\VehiclePresenter;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-19 "Sperren" (`qr.revoke`, recent password, reason): the code is revoked with reason `moderation`, so a scan answers 410 "nicht
 * mehr gültig" (ADR-148 b) and the owner cannot issue a new one themselves (VehiclePolicy::reissueQr, ADR-148 e); only staff can
 * (ReissueQrCodeAsStaff). One transaction under the vehicle's lock, as ReissueQrCode. The owner is mailed. Audited `qr.revoked_by_staff`.
 *
 * @throws AuthorizationException|DomainException when the code is not active
 */
class RevokeQrCode
{
    public function __construct(
        private readonly AuthMailer $mailer,
        private readonly VehiclePresenter $presenter,
    ) {}

    public function handle(Staff $staff, QrCode $qr, string $reason): QrCode
    {
        StaffAtoms::ensure($staff, 'qr.revoke');

        $vehicle = DB::transaction(function () use ($staff, $qr, $reason): ?Vehicle {
            $vehicle = $qr->vehicle_id === null ? null : Vehicle::withTrashed()->whereKey($qr->vehicle_id)->lockForUpdate()->first();
            $locked = QrCode::query()->whereKey($qr->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->status !== QrStatus::Active) {
                throw new DomainException('The code is not active.');
            }

            $locked->forceFill(['status' => QrStatus::Revoked, 'revoked_at' => now(), 'revoked_reason' => QrRevocationReason::Moderation])->save();
            $qr->setRawAttributes($locked->getAttributes(), true);

            Audit::record(AdminMemberEvent::QrRevoked->value, $locked, ['status' => QrStatus::Active->value], [
                'status' => QrStatus::Revoked->value,
                'revoked_reason' => QrRevocationReason::Moderation->value,
                'vehicle_id' => $locked->vehicle_id,
            ], trim($reason), $staff);

            return $vehicle;
        });

        $this->tellOwner($vehicle, 'revoked');

        return $qr;
    }

    /**
     * @param  'revoked'|'reissued'  $change
     */
    public function tellOwner(?Vehicle $vehicle, string $change): void
    {
        $owner = $vehicle === null ? null : User::query()->find($vehicle->owner_id);

        if ($vehicle === null || ! $owner instanceof User || $owner->isDeactivated()) {
            return;
        }

        $locale = $owner->getAttribute('locale');
        $this->mailer->sendLater($owner->email, is_string($locale) ? $locale : app()->getLocale(), new QrCodeChangedByStaffMail($change, $this->presenter->fullTitle($vehicle)));
    }
}
