<?php

namespace App\Services\Qr;

use App\Enums\QrRevocationReason;
use App\Enums\QrScanState;
use App\Models\QrCode;
use App\Models\Vehicle;

/**
 * The outcome of a scan. $qr and $vehicle exist so the server can count and redirect; only slug() may leave it, and only for an
 * active code, so that a revoked or private page has nothing about the vehicle to show.
 */
final readonly class QrResolution
{
    public function __construct(
        public QrScanState $state,
        public ?QrCode $qr = null,
        public ?Vehicle $vehicle = null,
    ) {}

    public function slug(): ?string
    {
        return $this->state === QrScanState::Active ? $this->vehicle?->canonicalSlug() : null;
    }

    /**
     * The key under public.qr_state of what WEB-06 and the app say. A revoked code gives no reason, since a replaced sticker and a
     * staff takedown must read alike. Only a code whose vehicle or account is gone says "nicht mehr verfügbar" (02_PRODUCT_SPEC
     * §3.2), still without anything of the vehicle. The code's own reason decides, so the old sticker of a sold car keeps saying
     * "nicht mehr gültig" when the seller deletes the vehicle later.
     */
    public function copy(): string
    {
        if ($this->state !== QrScanState::Revoked) {
            return $this->state->value;
        }

        $reason = $this->qr?->getAttribute('revoked_reason');
        $gone = in_array($reason, [QrRevocationReason::VehicleDeleted, QrRevocationReason::AccountDeleted], true)
            || ($reason === null && ($this->vehicle === null || $this->vehicle->trashed()));

        return $gone ? 'unavailable' : 'revoked';
    }
}
