<?php

namespace App\Http\Resources\V1;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * POST me/reauth: until when the sensitive endpoints accept this token or session without asking again.
 *
 * @property CarbonImmutable $resource
 */
class ReauthResource extends JsonResource
{
    /**
     * @return array{reauthenticated_until: string}
     */
    public function toArray(Request $request): array
    {
        return ['reauthenticated_until' => $this->resource->toIso8601String()];
    }
}
