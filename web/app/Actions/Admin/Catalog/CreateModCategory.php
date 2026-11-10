<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Models\ModCategory;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\CategoryRules;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-15 "Neue Kategorie" (`catalog.manage`): {key, name {de, en}, icon?, sort?, active?}. The sort is the category's place and its bit
 * in vehicle_search.mod_category_mask (1–63, unique); without one it goes last. A new category has no modifications, so no search row
 * changes. Audited as `catalog.category_created`.
 */
class CreateModCategory
{
    /**
     * @param  array<string, mixed>  $input
     *
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, array $input, ?string $reason = null): ModCategory
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::optional($reason);
        $valid = CategoryRules::validate($input, null);

        return DB::transaction(function () use ($staff, $valid, $reason): ModCategory {
            if (! array_key_exists('sort', $valid)) {
                $max = ModCategory::query()->lockForUpdate()->max('sort');
                $valid['sort'] = is_numeric($max) ? (int) $max + 1 : 1;
                CategoryRules::ensureSortFits((int) $valid['sort']);
            }

            $category = new ModCategory;
            $category->forceFill($valid)->save();

            Audit::record(CatalogEvent::CategoryCreated->value, $category, after: [...$valid], reason: $reason, actor: $staff);

            return $category;
        });
    }
}
