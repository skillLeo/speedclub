<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A WebAuthn ceremony (09 §8.2): `options` go to navigator.credentials.create()/get() (or the native passkey module) as they are, with
 * base64url byte fields; send `ceremony_id` back with the result. Single use, `expires_in` seconds.
 *
 * @property array{ceremony_id: string, options: array<array-key, mixed>} $resource
 */
class PasskeyOptionsResource extends JsonResource
{
    /**
     * @return array{ceremony_id: string, expires_in: int, options: array<array-key, mixed>}
     */
    public function toArray(Request $request): array
    {
        return [
            'ceremony_id' => $this->resource['ceremony_id'],
            'expires_in' => config()->integer('speedclub.passkeys.challenge_ttl_seconds'),
            /** PublicKeyCredentialCreationOptionsJSON or PublicKeyCredentialRequestOptionsJSON (WebAuthn L3). */
            'options' => $this->resource['options'],
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
