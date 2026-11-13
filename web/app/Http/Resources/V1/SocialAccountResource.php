<?php

namespace App\Http\Resources\V1;

use App\Enums\SocialProvider;
use App\Models\SocialAccount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A linked Apple or Google identity of the signed-in member. Never the provider's subject or a token.
 *
 * @property SocialAccount $resource
 */
class SocialAccountResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var SocialProvider */
            'provider' => $this->resource->provider,
            /** @var string|null */
            'email' => $this->resource->getAttribute('email'),
            'is_private_relay' => $this->resource->getAttribute('is_private_relay') === true,
            /** @var string */
            'linked_at' => $this->resource->created_at?->toIso8601String(),
            /** @var string|null */
            'last_used_at' => $this->resource->getAttribute('last_used_at')?->toIso8601String(),
        ];
    }
}
