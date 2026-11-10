<?php

namespace App\Http\Resources\V1;

use App\Models\VehicleModel;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin VehicleModel
 */
class VehicleModelResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'make_id' => $this->make_id,
            'name' => $this->name,
            'slug' => $this->slug,
        ];
    }
}
