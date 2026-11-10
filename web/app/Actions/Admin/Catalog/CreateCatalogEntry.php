<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Enums\CatalogLevel;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Staff;
use App\Models\VehicleModel;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\EntryRules;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-14 / ADM-16 "Neu" (`catalog.manage`): a make {name, slug?, country?, is_popular?, sort?, active?}, a model {make_id, name, slug?,
 * active?}, a generation {model_id, name, slug?, year_from?, year_to?, active?} or a brand {name, slug?, category_hint?, aliases?}. The
 * slug follows the name unless given. Audited as `catalog.created`. Also the step of an accepted catalogue request and of a CSV import.
 */
class CreateCatalogEntry
{
    /**
     * @param  array<string, mixed>  $input
     *
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, CatalogLevel $level, array $input, ?string $reason = null): Make|VehicleModel|Generation|Brand
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::optional($reason);
        $valid = EntryRules::entry($level, $input, create: true);
        $slug = EntryRules::slug(is_string($valid['slug'] ?? null) ? $valid['slug'] : null, (string) $valid['name']);

        return DB::transaction(function () use ($staff, $level, $valid, $slug, $reason): Make|VehicleModel|Generation|Brand {
            $parentId = match ($level) {
                CatalogLevel::Model => (int) $valid['make_id'],
                CatalogLevel::Generation => (int) $valid['model_id'],
                default => null,
            };

            if ($parentId !== null) {
                // The parent may not be merged away in the meantime.
                $parent = ($level === CatalogLevel::Model ? Make::query() : VehicleModel::query())->whereKey($parentId)->lockForUpdate()->first();

                if ($parent === null || $parent->getAttribute('merged_into_id') !== null) {
                    throw new CatalogRefused('merged');
                }
            }

            if (EntryRules::slugTaken($level, $slug, $parentId)) {
                throw new CatalogRefused('slug_taken', context: ['slug' => $slug]);
            }

            $row = match ($level) {
                CatalogLevel::Make => new Make,
                CatalogLevel::Model => new VehicleModel,
                CatalogLevel::Generation => new Generation,
                CatalogLevel::Brand => new Brand,
            };

            $attributes = [...$valid, 'slug' => $slug];

            if ($level === CatalogLevel::Make && ! array_key_exists('sort', $attributes)) {
                $max = Make::query()->max('sort');
                $attributes['sort'] = is_numeric($max) ? (int) $max + 1 : 1;
            }

            $row->forceFill($attributes)->save();

            Audit::record(CatalogEvent::Created->value, $row, after: ['level' => $level->value, ...$attributes], reason: $reason, actor: $staff);

            return $row->refresh();
        });
    }
}
