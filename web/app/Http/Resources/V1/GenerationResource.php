<?php

namespace App\Http\Resources\V1;

use App\Models\Generation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Generation
 */
class GenerationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'model_id' => $this->model_id,
            'name' => $this->name,
            'slug' => $this->slug,
            'year_from' => $this->year_from,
            'year_to' => $this->year_to,
        ];
    }
}
