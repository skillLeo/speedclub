<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Jobs\Catalog\RebuildCategorySearch;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\CategoryRules;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-15 category edit (`catalog.manage`, reason): name, icon, sort, active; the key only while no modification uses the category
 * (`category_key_locked`). A sort taken by another category swaps the two. A new sort or active flag changes what the search rows hold
 * (mod_category_mask, "has modification in category"), so every build is rebuilt in the queue. An inactive category is not offered for
 * new modifications (catalog/mod-categories) and stays on existing ones. Audited as `catalog.category_updated`.
 */
class UpdateModCategory
{
    /**
     * @param  array<string, mixed>  $input
     *
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, ModCategory $category, array $input, string $reason): ModCategory
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::required($reason);
        $valid = CategoryRules::validate($input, $category);

        return DB::transaction(function () use ($staff, $category, $valid, $reason): ModCategory {
            /** @var ModCategory $row */
            $row = ModCategory::query()->whereKey($category->getKey())->lockForUpdate()->firstOrFail();
            $before = ['key' => $row->key, 'name' => $row->getTranslations('name'), 'icon' => $row->getAttribute('icon'), 'sort' => $row->getAttribute('sort'), 'active' => $row->getAttribute('active')];
            $row->forceFill($valid);
            $dirty = array_keys($row->getDirty());

            if ($dirty === []) {
                return $row;
            }

            if (in_array('key', $dirty, true) && Modification::withTrashed()->where('category_id', $row->getKey())->exists()) {
                throw new CatalogRefused('category_key_locked', Modification::withTrashed()->where('category_id', $row->getKey())->count());
            }

            if (in_array('sort', $dirty, true)) {
                $other = ModCategory::query()->whereKeyNot($row->getKey())->where('sort', $row->getAttribute('sort'))->lockForUpdate()->first();

                if ($other !== null) {
                    // Two steps: sort is not unique in the schema, but the mask needs one bit per category.
                    $other->forceFill(['sort' => $before['sort']])->save();
                }
            }

            $row->save();

            if (array_intersect($dirty, ['sort', 'active', 'key']) !== []) {
                DB::afterCommit(fn () => RebuildCategorySearch::dispatch(0));
            }

            Audit::record(CatalogEvent::CategoryUpdated->value, $row,
                before: array_intersect_key($before, array_flip($dirty)),
                after: array_intersect_key(['key' => $row->key, 'name' => $row->getTranslations('name'), 'icon' => $row->getAttribute('icon'), 'sort' => $row->getAttribute('sort'), 'active' => $row->getAttribute('active')], array_flip($dirty)),
                reason: $reason, actor: $staff);

            return $row;
        });
    }
}
