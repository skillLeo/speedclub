<?php

namespace App\Actions\Admin\Catalog;

use App\Jobs\Catalog\RebuildCategorySearch;
use App\Models\ModCategory;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Catalog\Reason;
use App\Services\Catalog\SchemaVersions;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The frame of every ADM-15 field change (m3.3 §1): the atom, the reason, the category row locked, the change, then one schema version
 * and one `catalog.schema_changed` event (SchemaVersions), and, when the change alters what the search rows read (a searchable flag,
 * options, a key), a queued rebuild of the category's builds.
 */
final class ModFieldChange
{
    /**
     * @template T
     *
     * @param  Closure(ModCategory): T  $change
     * @return T
     *
     * @throws AuthorizationException|ValidationException
     */
    public static function run(Staff $staff, ModCategory $category, string $reason, string $name, Closure $change, bool $rebuildsSearch = false): mixed
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::required($reason);

        return DB::transaction(function () use ($staff, $category, $reason, $name, $change, $rebuildsSearch): mixed {
            /** @var ModCategory $locked */
            $locked = ModCategory::query()->whereKey($category->getKey())->lockForUpdate()->firstOrFail();
            $before = SchemaVersions::snapshot($locked);
            $result = $change($locked);
            $after = SchemaVersions::snapshot($locked);

            if ($after === $before) {
                return $result;
            }

            SchemaVersions::record($locked, $staff, $reason, $before, $name);

            if ($rebuildsSearch) {
                $id = (int) $locked->getKey();
                DB::afterCommit(fn () => RebuildCategorySearch::dispatch($id));
            }

            return $result;
        });
    }
}
