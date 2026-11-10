<?php

namespace App\Http\Resources\V1;

use App\Support\Auth\AuthResult;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A finished sign-in. token and token_expires_at are null for the cookie session of the SPA.
 *
 * @property AuthResult $resource
 */
class AuthSessionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var string|null $token */
        $token = $this->resource->token;
        /** @var string|null $expiresAt */
        $expiresAt = $this->resource->tokenExpiresAt?->format(DATE_ATOM);

        return [
            'token' => $token,
            'token_expires_at' => $expiresAt,
            'member' => new MeResource($this->resource->user),
        ];
    }

    /**
     * A token must not stay in any cache.
     *
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->headers->set('Cache-Control', 'no-store, private');
    }
}
