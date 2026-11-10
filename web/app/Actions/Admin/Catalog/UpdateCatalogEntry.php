<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Jobs\Catalog\RelinkBrandModifications;
use App\Jobs\Catalog\RelinkCatalogVehicles;
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
use App\Services\Catalog\EntryRules;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-14 / ADM-16 "Bearbeiten" (`catalog.manage`): only the keys sent change (as CreateCatalogEntry, without parent and active, which
 * have their own Actions: a merge moves an entry, SetCatalogEntryActive switches it). The slug may change only while nothing points
 * at the entry (m3.3 §2: "slug auto + editable before first reference"); a merged row is not edited. A new name reaches the builds
 * through a queued relink (vehicle slugs, so an old /v/ URL answers 301, and the search rows). Audited as `catalog.updated` with the
 * changed attributes.
 */
class UpdateCatalogEntry
{
    /**
     * @param  array<string, mixed>  $input
     *
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, Make|VehicleModel|Generation|Brand $entry, array $input, ?string $reason = null): Make|VehicleModel|Generation|Brand
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::optional($reason);
        $level = CatalogMerger::level($entry);
        $valid = EntryRules::entry($level, $input, create: false);

        return DB::transaction(function () use ($staff, $entry, $level, $valid, $reason): Make|VehicleModel|Generation|Brand {
            /** @var Make|VehicleModel|Generation|Brand $row */
            $row = $entry->newQuery()->whereKey($entry->getKey())->lockForUpdate()->firstOrFail();

            if ($row->getAttribute('merged_into_id') !== null) {
                throw new CatalogRefused('merged');
            }

            if (array_key_exists('slug', $valid)) {
                $valid['slug'] = EntryRules::slug(is_string($valid['slug']) ? $valid['slug'] : null, (string) ($valid['name'] ?? $row->getAttribute('name')));
            }

            if ($row instanceof Generation) {
                $from = array_key_exists('year_from', $valid) ? $valid['year_from'] : $row->getAttribute('year_from');
                $to = array_key_exists('year_to', $valid) ? $valid['year_to'] : $row->getAttribute('year_to');

                if (is_int($from) && is_int($to) && $from > $to) {
                    throw ValidationException::withMessages(['year_to' => [(string) __('validation.gte.numeric', ['attribute' => 'year to', 'value' => $from])]]);
                }
            }

            $before = $row->only(array_keys($valid));
            // Against the stored slug: a Kollektion names the old one.
            $locked = array_key_exists('slug', $valid) && $valid['slug'] !== $row->getAttribute('slug') && CatalogReferences::slugLocked($row);
            $row->forceFill($valid);
            $dirty = array_keys($row->getDirty());

            if ($dirty === []) {
                return $row;
            }

            if (in_array('slug', $dirty, true)) {
                if ($locked) {
                    throw new CatalogRefused('slug_locked');
                }

                if (EntryRules::slugTaken($level, (string) $row->getAttribute('slug'), $this->parentId($row), (int) $row->getKey())) {
                    throw new CatalogRefused('slug_taken', context: ['slug' => (string) $row->getAttribute('slug')]);
                }
            }

            $row->save();

            if (in_array('name', $dirty, true) || in_array('slug', $dirty, true)) {
                $id = (int) $row->getKey();
                DB::afterCommit(fn () => $row instanceof Brand
                    ? RelinkBrandModifications::dispatch($id)
                    : RelinkCatalogVehicles::dispatch(RelinkCatalogVehicles::entry($level, $id)));
            }

            Audit::record(CatalogEvent::Updated->value, $row,
                before: ['level' => $level->value, ...array_intersect_key($before, array_flip($dirty))],
                after: ['level' => $level->value, ...$row->only($dirty)],
                reason: $reason, actor: $staff);

            return $row;
        });
    }

    private function parentId(Make|VehicleModel|Generation|Brand $row): ?int
    {
        return match (true) {
            $row instanceof VehicleModel => (int) $row->getAttribute('make_id'),
            $row instanceof Generation => (int) $row->getAttribute('model_id'),
            default => null,
        };
    }
}
