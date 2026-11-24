<?php

namespace App\Actions\Admin\Forum;

use App\Enums\ErrorCode;
use App\Enums\ForumAuditEvent;
use App\Enums\ForumCategoryKind;
use App\Exceptions\ApiException;
use App\Models\ForumCategory;
use App\Models\ForumThread;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Forum\ForumCategorySync;
use Illuminate\Support\Facades\DB;

/**
 * ADM Forum › Kategorien (10 §7.1, m5.8-contract §6): create, edit (names, descriptions, icon, parent, active), reorder, delete an
 * empty one, and "Marken abgleichen" (one sub-category per make, ForumCategorySync). One level of sub-categories only. Every write is
 * audited with before and after.
 */
class ManageForumCategories
{
    private const FIELDS = ['slug', 'name_de', 'name_en', 'description_de', 'description_en', 'icon', 'parent_id', 'is_active'];

    public function __construct(private readonly ForumCategorySync $sync) {}

    /**
     * @param  array<string, mixed>  $values
     */
    public function add(Staff $staff, array $values, ?string $reason): ForumCategory
    {
        return DB::transaction(function () use ($staff, $values, $reason): ForumCategory {
            $this->guardParent($values['parent_id'] ?? null, null);
            $category = new ForumCategory;
            $category->forceFill([
                ...array_intersect_key($values, array_flip(self::FIELDS)),
                'kind' => ForumCategoryKind::Standard,
                'sort' => 1 + (int) ForumCategory::query()->where('parent_id', $values['parent_id'] ?? null)->max('sort'),
            ])->save();
            Audit::record(ForumAuditEvent::CategoryCreated->value, $category, null, $this->snapshot($category), $reason, $staff);

            return $category;
        });
    }

    /**
     * @param  array<string, mixed>  $values
     */
    public function change(Staff $staff, ForumCategory $category, array $values, ?string $reason): ForumCategory
    {
        return DB::transaction(function () use ($staff, $category, $values, $reason): ForumCategory {
            if (array_key_exists('parent_id', $values)) {
                $this->guardParent($values['parent_id'], $category);
            }

            $before = $this->snapshot($category);
            $category->forceFill(array_intersect_key($values, array_flip(self::FIELDS)))->save();
            Audit::record(ForumAuditEvent::CategoryUpdated->value, $category, $before, $this->snapshot($category), $reason, $staff);

            return $category;
        });
    }

    /**
     * Only a category without threads (any state) and without sub-categories; otherwise deactivate it.
     */
    public function remove(Staff $staff, ForumCategory $category, ?string $reason): void
    {
        DB::transaction(function () use ($staff, $category, $reason): void {
            if (ForumThread::withTrashed()->where('category_id', $category->id)->exists() || ForumCategory::query()->where('parent_id', $category->id)->exists()) {
                throw new ApiException(ErrorCode::Conflict, (string) __('errors.forum_category_in_use'));
            }

            $before = $this->snapshot($category);
            $category->delete();
            Audit::record(ForumAuditEvent::CategoryDeleted->value, $category, $before, null, $reason, $staff);
        });
    }

    /**
     * @param  list<int>  $ids  the new order of the categories of one parent (or of the top level)
     */
    public function reorder(Staff $staff, array $ids, ?string $reason): void
    {
        DB::transaction(function () use ($staff, $ids, $reason): void {
            $rows = ForumCategory::query()->whereKey($ids)->get();
            $parents = $rows->pluck('parent_id')->unique();

            if ($rows->count() !== count($ids) || $parents->count() > 1) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['ids' => [(string) __('validation.in', ['attribute' => 'ids'])]]);
            }

            $before = $rows->sortBy('sort')->pluck('id')->values()->all();

            foreach ($ids as $position => $id) {
                ForumCategory::query()->whereKey($id)->update(['sort' => $position]);
            }

            Audit::record(ForumAuditEvent::CategoriesReordered->value, null, ['order' => $before], ['order' => $ids, 'parent_id' => $parents->first()], $reason, $staff);
        });
    }

    /**
     * @return array{created: int}
     */
    public function syncMakes(Staff $staff, ?string $reason): array
    {
        $result = $this->sync->run();
        Audit::record(ForumAuditEvent::CategoriesSynced->value, null, null, $result, $reason, $staff);

        return $result;
    }

    private function guardParent(mixed $parentId, ?ForumCategory $category): void
    {
        if ($parentId === null) {
            return;
        }

        $parent = ForumCategory::query()->find($parentId);
        $hasChildren = $category !== null && ForumCategory::query()->where('parent_id', $category->id)->exists();

        if (! $parent instanceof ForumCategory || $parent->parent_id !== null || $parent->id === $category?->id || $hasChildren) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['parent_id' => [(string) __('errors.forum_category_parent')]]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(ForumCategory $category): array
    {
        return [...array_intersect_key($category->getAttributes(), array_flip(self::FIELDS)), 'sort' => $category->sort];
    }
}
