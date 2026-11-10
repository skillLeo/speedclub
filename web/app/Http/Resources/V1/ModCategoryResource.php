<?php

namespace App\Http\Resources\V1;

use App\Models\ModCategory;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin ModCategory
 */
class ModCategoryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'key' => $this->key,
            /** @var string */
            'name' => $this->getTranslation('name', app()->getLocale()),
            'icon' => $this->icon,
            'fields' => ModCategoryFieldResource::collection($this->whenLoaded('fields')),
        ];
    }
}
