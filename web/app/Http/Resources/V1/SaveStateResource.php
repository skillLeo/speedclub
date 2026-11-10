<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer to save and unsave [SIG sig.saved_builds]: the state, never whether it changed.
 */
class SaveStateResource extends JsonResource
{
    private string $vehicleId = '';

    private bool $isSaved = false;

    public static function of(string $vehicleId, bool $isSaved): self
    {
        $state = new self(null);
        $state->vehicleId = $vehicleId;
        $state->isSaved = $isSaved;

        return $state;
    }

    /**
     * @return array{vehicle_id: string, is_saved: bool}
     */
    public function toArray(Request $request): array
    {
        return [
            'vehicle_id' => $this->vehicleId,
            /** @var bool */
            'is_saved' => $this->isSaved,
        ];
    }
}
