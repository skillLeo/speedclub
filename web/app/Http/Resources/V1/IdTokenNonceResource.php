<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SEC-M46-05: a nonce for one Apple or Google sign-in or link.
 *
 * @property array{nonce: string, expires_in: int} $resource
 */
class IdTokenNonceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** Give it to the provider SDK (Apple: its SHA-256 hex), then send it unchanged with the ID token. Single use. */
            'nonce' => $this->resource['nonce'],
            /** Seconds it stays valid. */
            'expires_in' => $this->resource['expires_in'],
        ];
    }
}
