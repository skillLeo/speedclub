<?php

namespace App\Services\Forum;

use App\Models\ForumCategory;
use Illuminate\Database\Eloquent\Collection;

/**
 * The category tree of FOR-01/02/04: top-level categories in their order with their active sub-categories; lookups by slug only find a
 * category that is open (active, under an active parent).
 */
final class ForumCategories
{
    public function __construct(private readonly ForumVisibility $visibility) {}

    /**
     * @return Collection<int, ForumCategory>
     */
    public function tree(): Collection
    {
        return ForumCategory::query()->whereNull('parent_id')->where('is_active', true)
            ->with('children')->orderBy('sort')->orderBy('id')->get();
    }

    public function open(?string $slug): ?ForumCategory
    {
        if ($slug === null || $slug === '') {
            return null;
        }

        $category = ForumCategory::query()->with(['parent', 'children'])->where('slug', $slug)->first();

        return $category instanceof ForumCategory && in_array($category->id, $this->visibility->openCategoryIds(), true) ? $category : null;
    }
}
