<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer of PUT/DELETE vehicles/{id}/follow: the state, never a count (09 §8.6).
 */
class VehicleFollowStateResource extends JsonResource
{
    private string $vehicleId = '';

    private bool $following = false;

    public static function of(string $vehicleId, bool $following): self
    {
        $state = new self(null);
        $state->vehicleId = $vehicleId;
        $state->following = $following;

        return $state;
    }

    /**
     * @return array{vehicle_id: string, is_following: bool}
     */
    public function toArray(Request $request): array
    {
        return [
            'vehicle_id' => $this->vehicleId,
            /** @var bool */
            'is_following' => $this->following,
        ];
    }
}
