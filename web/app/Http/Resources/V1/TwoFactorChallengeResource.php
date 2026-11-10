<?php

namespace App\Http\Resources\V1;

use App\Support\Auth\TwoFactorPending;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * AUTH-11: the first factor was right, the account has two-factor. No session and no token yet: send `challenge` with a code to
 * POST auth/two-factor/challenge within `expires_in` seconds (single use).
 *
 * @property TwoFactorPending $resource
 */
class TwoFactorChallengeResource extends JsonResource
{
    /**
     * @return array{two_factor_required: true, challenge: string, expires_in: int}
     */
    public function toArray(Request $request): array
    {
        return [
            'two_factor_required' => true,
            'challenge' => $this->resource->challenge,
            'expires_in' => $this->resource->expiresIn,
        ];
    }

    /**
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->headers->set('Cache-Control', 'no-store, private');
    }
}
