<?php

namespace App\Actions\Admin\Catalog;

use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Catalog\CatalogRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-15 drag order (`catalog.manage`, reason): $ids are every field id of the category (archived ones included) in the new order;
 * anything else is refused (`fields_mismatch`). Sorts become 1…n. One schema version.
 */
class ReorderModFields
{
    /**
     * @param  list<int|string>  $ids
     *
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, ModCategory $category, array $ids, string $reason): void
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $ids = array_map(intval(...), $ids);

        ModFieldChange::run($staff, $category, $reason, 'fields_reordered', function (ModCategory $locked) use ($ids): void {
            $current = array_map(intval(...), ModCategoryField::query()->where('category_id', $locked->getKey())->lockForUpdate()->pluck('id')->all());
            $sorted = $ids;
            sort($sorted);
            sort($current);

            if ($sorted !== $current || count(array_unique($ids)) !== count($ids)) {
                throw new CatalogRefused('fields_mismatch');
            }

            foreach ($ids as $position => $id) {
                ModCategoryField::query()->whereKey($id)->update(['sort' => $position + 1, 'updated_at' => now()]);
            }
        });
    }
}
