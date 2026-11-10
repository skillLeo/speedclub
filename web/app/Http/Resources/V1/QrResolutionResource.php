<?php

namespace App\Http\Resources\V1;

use App\Enums\QrScanState;
use App\Services\Qr\QrResolution;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET qr/{code} for the app's resolver. `slug` is null for everything but `active`, whoever asks: revoked shows nothing of the vehicle.
 *
 * @property QrResolution $resource
 */
class QrResolutionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $state = $this->resource->state;
        $copy = $this->resource->copy();

        return [
            /** @var QrScanState */
            'state' => $state,
            /** Open /v/{slug} when `state` is `active`. */
            'slug' => $this->resource->slug(),
            /**
             * "Dieser QR-Code ist nicht mehr gültig", or for a revoked code whose vehicle or account was deleted "Dieses Fahrzeug ist nicht
             * mehr verfügbar"; null when `state` is `active`.
             *
             * @var string|null
             */
            'title' => $state === QrScanState::Active ? null : (string) __('public.qr_state.'.$copy.'.title'),
            /** @var string|null */
            'message' => $state === QrScanState::Active ? null : (string) __('public.qr_state.'.$copy.'.body'),
        ];
    }
}
