<?php

namespace App\Http\Resources\V1;

use App\Models\Brand;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Brand
 */
class BrandResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'category_hint' => $this->category_hint,
            /** @var list<string> */
            'aliases' => $this->aliases ?? [],
        ];
    }
}
