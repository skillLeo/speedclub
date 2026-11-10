<?php

namespace App\Http\Resources\V1;

use App\Models\CatalogRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin CatalogRequest
 */
class CatalogRequestResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'vehicle_id' => $this->vehicle_id,
            'make_text' => $this->make_text,
            'model_text' => $this->model_text,
            'generation_text' => $this->generation_text,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
