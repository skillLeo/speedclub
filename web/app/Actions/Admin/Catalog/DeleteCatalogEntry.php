<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Staff;
use App\Models\VehicleModel;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogMerger;
use App\Services\Catalog\CatalogReferences;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-14 / ADM-16 "Löschen" (`catalog.manage`, reason; the page asks for the typed confirmation): only an entry nothing points at
 * (CatalogReferences::forDelete: vehicles, also deleted ones in their 30 days, modifications, aliases, Kollektionen), with everything
 * below it (a make's models and generations, a model's generations), which must be unreferenced as well. Otherwise refused with the
 * count (`referenced`); the page offers deactivate or merge instead. Audited as `catalog.deleted` with what went.
 */
class DeleteCatalogEntry
{
    /**
     * @return array{models: int, generations: int}
     *
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, Make|VehicleModel|Generation|Brand $entry, string $reason): array
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::required($reason);

        return DB::transaction(function () use ($staff, $entry, $reason): array {
            /** @var Make|VehicleModel|Generation|Brand $row */
            $row = $entry->newQuery()->whereKey($entry->getKey())->lockForUpdate()->firstOrFail();
            $references = CatalogReferences::forDelete($row);
            $total = array_sum($references);

            if ($total > 0) {
                throw new CatalogRefused('referenced', $total, $references);
            }

            $removed = ['models' => 0, 'generations' => 0];

            if (! $row instanceof Brand) {
                [, $models, $generations] = CatalogReferences::subtree($row);

                if (! $row instanceof Generation) {
                    $removed['generations'] = Generation::query()->whereIn('id', $generations ?: [0])->delete();
                }

                if ($row instanceof Make) {
                    $removed['models'] = VehicleModel::query()->whereIn('id', $models ?: [0])->delete();
                }
            }

            $snapshot = ['level' => CatalogMerger::level($row)->value, 'name' => $row->getAttribute('name'), 'slug' => $row->getAttribute('slug')];
            $row->delete();

            Audit::record(CatalogEvent::Deleted->value, $row, before: $snapshot, after: $removed, reason: $reason, actor: $staff);

            return $removed;
        });
    }
}
