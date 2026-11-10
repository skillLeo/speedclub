<?php

namespace App\Http\Resources\V1;

use App\Support\Auth\TwoFactorSetup;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-05 step 1: the key for the authenticator app, as text (manual entry), as otpauth URL and as a black-on-white SVG QR code.
 * Pending until POST me/two-factor/confirm. Sent with Cache-Control: no-store.
 *
 * @property TwoFactorSetup $resource
 */
class TwoFactorSetupResource extends JsonResource
{
    use NoStore;

    /**
     * @return array{secret: string, otpauth_url: string, qr_svg: string}
     */
    public function toArray(Request $request): array
    {
        return [
            'secret' => $this->resource->secret,
            'otpauth_url' => $this->resource->otpauthUrl,
            'qr_svg' => $this->resource->qrSvg,
        ];
    }
}
