<?php

namespace App\Http\Resources\V1\Forum;

use App\Models\ForumCategory;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A forum category (FOR-01 chips, FOR-02 header, FOR-04 picker) in the reader's language. No counts (ADR-506: only reply and
 * "Hilfreich" counts are shown).
 *
 * @property ForumCategory $resource
 */
class ForumCategoryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $category = $this->resource;

        return [
            'id' => $category->id,
            'slug' => $category->slug,
            /** standard · make (one per catalogue make, under "Marken & Modelle") · region (one per Bundesland, under "Treffen & Regionen"). */
            'kind' => $category->kind,
            'name' => $category->name(),
            'description' => $category->description(),
            /** Phosphor icon key for the chip, or null. */
            'icon' => $category->icon,
            'parent_id' => $category->parent_id,
            /**
             * Active sub-categories in their order (top-level categories of the tree only; empty for a sub-category).
             *
             * @var list<ForumCategoryResource>
             */
            'children' => $category->relationLoaded('children')
                ? $category->getRelation('children')->filter(fn (ForumCategory $child): bool => $child->is_active)->values()->map(fn (ForumCategory $child): self => new self($child))->all()
                : [],
        ];
    }
}
