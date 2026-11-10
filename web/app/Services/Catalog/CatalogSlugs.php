<?php

namespace App\Services\Catalog;

use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Services\Discover\ModelKey;

/**
 * Slug lookups of the catalogue that know merges (M3.3 §1): a merged make, model, generation or brand stays as a row with
 * `merged_into_id`, so its slug keeps resolving, to the survivor. Merges flatten their chains (CatalogMerger), so one hop is enough;
 * a few more are followed in case a chain was ever left behind. Used by Discover (make and model pages, the DISC-04 lists), the
 * search filters (SearchFilterResolver) and the CSV import.
 *
 * A model slug is looked up under the make and under every make merged into it, as a merged make keeps the models that were merged
 * away from it ("x--m4" after X → Y: make x answers Y, and the old model row under X answers its survivor).
 */
final class CatalogSlugs
{
    private const MAX_HOPS = 5;

    public static function make(string $slug): ?Make
    {
        $make = Make::query()->where('slug', $slug)->first();

        return $make === null ? null : self::survivor($make);
    }

    public static function model(Make $make, string $slug): ?VehicleModel
    {
        $makes = [$make->getKey(), ...Make::query()->where('merged_into_id', $make->getKey())->pluck('id')->all()];
        $model = VehicleModel::query()->whereIn('make_id', $makes)->where('slug', $slug)
            // The make's own row first, then the merged makes' rows.
            ->orderByRaw('make_id = ? desc', [$make->getKey()])
            ->orderBy('id')
            ->first();

        return $model === null ? null : self::survivor($model);
    }

    /**
     * The DISC-04 route key "{make}--{model}" (ModelKey), with the make loaded.
     */
    public static function modelKey(string $key): ?VehicleModel
    {
        $parts = explode(ModelKey::SEPARATOR, $key);

        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            return null;
        }

        $make = self::make($parts[0]);
        $model = $make === null ? null : self::model($make, $parts[1]);

        return $model?->load('make');
    }

    public static function generation(VehicleModel $model, string $slug): ?Generation
    {
        $models = [$model->getKey(), ...VehicleModel::query()->where('merged_into_id', $model->getKey())->pluck('id')->all()];
        $generation = Generation::query()->whereIn('model_id', $models)->where('slug', $slug)
            ->orderByRaw('model_id = ? desc', [$model->getKey()])
            ->orderBy('id')
            ->first();

        return $generation === null ? null : self::survivor($generation);
    }

    public static function brand(string $slug): ?Brand
    {
        $brand = Brand::query()->where('slug', $slug)->first();

        return $brand === null ? null : self::survivor($brand);
    }

    /**
     * The row a merged row stands for now; the row itself when it was never merged.
     *
     * @template T of Make|VehicleModel|Generation|Brand
     *
     * @param  T  $row
     * @return T
     */
    public static function survivor(Make|VehicleModel|Generation|Brand $row): Make|VehicleModel|Generation|Brand
    {
        $hops = 0;

        while ($row->getAttribute('merged_into_id') !== null && $hops < self::MAX_HOPS) {
            $next = $row->newQuery()->find($row->getAttribute('merged_into_id'));

            if ($next === null) {
                break;
            }

            /** @var T $next */
            $row = $next;
            $hops++;
        }

        return $row;
    }

    /**
     * The id a stored id stands for now (vehicles and modifications pointing at a merged row until the relink job reached them).
     *
     * @param  class-string<Make|VehicleModel|Generation|Brand>  $class
     */
    public static function survivorId(string $class, ?int $id): ?int
    {
        if ($id === null) {
            return null;
        }

        $row = $class::query()->find($id);

        return $row === null ? $id : (int) self::survivor($row)->getKey();
    }
}
