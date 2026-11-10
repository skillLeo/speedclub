<?php

namespace App\Services\Catalog;

use App\Enums\CatalogLevel;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Services\Discover\ModelKey;
use Illuminate\Support\Facades\DB;

/**
 * What points at a catalogue entry (m3.3 §1: nothing a vehicle or modification points at is ever deleted). Vehicles count with the
 * deleted ones still in their 30 days (they keep their foreign keys), modifications with the soft-deleted ones. An entry is also
 * referenced by the merged rows that stand for it (its aliases), by merged rows below it (aliases of other entries) and by a
 * Kollektion whose filters name its slug.
 */
final class CatalogReferences
{
    /**
     * Vehicles of the entry and everything below it: what a merge relinks and what the impact count of the merge picker shows. For a
     * brand: the vehicles with a modification of it.
     */
    public static function vehicles(CatalogLevel $level, int $id): int
    {
        if ($level === CatalogLevel::Brand) {
            return (int) DB::table('modifications')->where('brand_id', $id)->distinct()->count('vehicle_id');
        }

        return DB::table('vehicles')->where((string) $level->vehicleColumn(), $id)->count();
    }

    /** Modifications of a brand, soft-deleted ones included (its usage count in ADM-16). */
    public static function modifications(int $brandId): int
    {
        return DB::table('modifications')->where('brand_id', $brandId)->count();
    }

    /**
     * Everything that forbids deleting the entry, by kind: {vehicles, modifications, aliases, collections}. Zero everywhere means it
     * may go, with what is below it.
     *
     * @return array{vehicles: int, modifications: int, aliases: int, collections: int}
     */
    public static function forDelete(Make|VehicleModel|Generation|Brand $entry): array
    {
        $counts = ['vehicles' => 0, 'modifications' => 0, 'aliases' => 0, 'collections' => 0];

        if ($entry instanceof Brand) {
            $counts['modifications'] = self::modifications((int) $entry->getKey());
            $counts['aliases'] = Brand::query()->where('merged_into_id', $entry->getKey())->count() + ($entry->getAttribute('merged_into_id') !== null ? 1 : 0);
            $counts['collections'] = self::collectionsNaming(['wheel_brand', 'suspension_brand', 'exhaust_brand'], (string) $entry->getAttribute('slug'), true);

            return $counts;
        }

        [$makes, $models, $generations] = self::subtree($entry);

        $counts['vehicles'] = DB::table('vehicles')
            ->where(function ($query) use ($makes, $models, $generations): void {
                $query->whereIn('make_id', $makes ?: [0])->orWhereIn('model_id', $models ?: [0])->orWhereIn('generation_id', $generations ?: [0]);
            })
            ->count();

        // Merged rows inside the subtree are aliases of other entries; merged rows outside pointing into it are this entry's aliases.
        $counts['aliases'] = Make::query()->whereIn('id', $makes ?: [0])->whereNotNull('merged_into_id')->count()
            + VehicleModel::query()->whereIn('id', $models ?: [0])->whereNotNull('merged_into_id')->count()
            + Generation::query()->whereIn('id', $generations ?: [0])->whereNotNull('merged_into_id')->count()
            + Make::query()->whereIn('merged_into_id', $makes ?: [0])->count()
            + VehicleModel::query()->whereIn('merged_into_id', $models ?: [0])->count()
            + Generation::query()->whereIn('merged_into_id', $generations ?: [0])->count();

        $counts['collections'] = match (true) {
            $entry instanceof Make => self::collectionsNaming(['make'], (string) $entry->getAttribute('slug')),
            $entry instanceof VehicleModel => self::collectionsNamingModel($entry),
            default => self::collectionsNaming(['generation'], (string) $entry->getAttribute('slug')),
        };

        return $counts;
    }

    /**
     * Whether anything points at the entry itself (its slug is then part of URLs and filters and may no longer change).
     */
    public static function slugLocked(Make|VehicleModel|Generation|Brand $entry): bool
    {
        return array_sum(self::forDelete($entry)) > 0;
    }

    /**
     * Ids of the entry and everything below it: [makes, models, generations].
     *
     * @return array{0: list<int>, 1: list<int>, 2: list<int>}
     */
    public static function subtree(Make|VehicleModel|Generation $entry): array
    {
        $makes = [];
        $models = [];
        $generations = [];

        if ($entry instanceof Make) {
            $makes = [(int) $entry->getKey()];
            $models = array_values(array_map(intval(...), VehicleModel::query()->where('make_id', $entry->getKey())->pluck('id')->all()));
        } elseif ($entry instanceof VehicleModel) {
            $models = [(int) $entry->getKey()];
        } else {
            $generations = [(int) $entry->getKey()];
        }

        if ($models !== []) {
            $generations = array_values(array_map(intval(...), Generation::query()->whereIn('model_id', $models)->pluck('id')->all()));
        }

        return [$makes, $models, $generations];
    }

    /**
     * @param  list<string>  $keys
     */
    private static function collectionsNaming(array $keys, string $slug, bool $list = false): int
    {
        return DB::table('collections')->where(function ($query) use ($keys, $slug, $list): void {
            foreach ($keys as $key) {
                $list ? $query->orWhereJsonContains('filters->'.$key, $slug) : $query->orWhere('filters->'.$key, $slug);
            }
        })->count();
    }

    private static function collectionsNamingModel(VehicleModel $model): int
    {
        $slug = (string) $model->getAttribute('slug');
        $make = Make::query()->find((int) $model->getAttribute('make_id'));
        $key = $make === null ? null : ModelKey::of($model, $make);

        return DB::table('collections')->where(function ($query) use ($slug, $key, $make): void {
            $query->where(fn ($inner) => $inner->where('filters->model', $slug)->where('filters->make', $make?->getAttribute('slug')));

            if ($key !== null) {
                $query->orWhere('filters->model', $key);
            }
        })->count();
    }
}
