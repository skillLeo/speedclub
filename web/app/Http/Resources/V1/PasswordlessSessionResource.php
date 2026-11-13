<?php

namespace App\Http\Resources\V1;

use App\Enums\SignInNext;
use App\Support\Auth\PasswordlessResult;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A finished passwordless sign-in (e-mail code, Apple, Google, passkey): the AuthSessionResource fields plus `is_new` (the account was
 * created by this request) and `next`, the screen to open (terms = AUTH-09b, username = AUTH-08, profile = AUTH-09, done).
 *
 * @property PasswordlessResult $resource
 */
class PasswordlessSessionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var string|null $token */
        $token = $this->resource->session->token;
        /** @var string|null $expiresAt */
        $expiresAt = $this->resource->session->tokenExpiresAt?->format(DATE_ATOM);

        return [
            'token' => $token,
            'token_expires_at' => $expiresAt,
            'member' => new MeResource($this->resource->session->user),
            'is_new' => $this->resource->isNew,
            /** @var SignInNext */
            'next' => $this->resource->next(),
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
