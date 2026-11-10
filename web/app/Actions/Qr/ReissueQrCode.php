<?php

namespace App\Actions\Qr;

use App\Enums\MemberSecurityEvent;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Audit\Audit;
use App\Services\Qr\QrCodes;
use Illuminate\Support\Facades\DB;

/**
 * Revoke and reissue (QR-02): the old sticker reads "nicht mehr gültig" from this moment on, and the new code is the only active one.
 * One transaction under the vehicle's row lock, which ensureActive also takes.
 */
class ReissueQrCode
{
    public function __construct(private readonly QrCodes $codes) {}

    public function handle(User $user, Vehicle $vehicle): QrCode
    {
        return DB::transaction(function () use ($user, $vehicle): QrCode {
            Vehicle::query()->whereKey($vehicle->getKey())->lockForUpdate()->firstOrFail();

            $previous = $vehicle->qrCodes()->where('status', QrStatus::Active)->value('code');

            $this->codes->revoke($vehicle, QrRevocationReason::Reissued);
            $qr = $this->codes->ensureActive($vehicle);

            Audit::record(
                MemberSecurityEvent::QrReissued->value,
                $vehicle,
                ['code' => $previous],
                ['code' => $qr->code],
                QrRevocationReason::Reissued->value,
                $user,
            );

            return $qr;
        });
    }
}
