<?php

namespace App\Http\Resources\V1;

use App\Enums\UsernameUnavailableReason;
use App\Support\Username;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array{username: string, reason: UsernameUnavailableReason|null} $resource
 */
class UsernameAvailabilityResource extends JsonResource
{
    /**
     * @return array{username: string, available: bool, reason: UsernameUnavailableReason|null}
     */
    public function toArray(Request $request): array
    {
        return [
            'username' => Username::normalize($this->resource['username']),
            'available' => $this->resource['reason'] === null,
            /** @var UsernameUnavailableReason|null */
            'reason' => $this->resource['reason'],
        ];
    }
}
