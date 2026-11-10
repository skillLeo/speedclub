<?php

namespace App\Services\Ai;

use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogSlugs;
use Illuminate\Support\Str;

/**
 * What a model wrote ("BMW", "kw", "BBS Motorsport") → the catalogue row it names, or null. By slug, by name (case-insensitive) and for
 * brands by alias; a merged row counts as its survivor (ADR-234). Never creates anything: an unknown value is simply dropped.
 */
final class CatalogLookup
{
    public static function make(string $value): ?Make
    {
        $slug = Str::slug($value);
        /** @var array<string, string> $aliases */
        $aliases = config()->array('speedclub.search.make_aliases', []);
        $slug = $aliases[$slug] ?? $slug;

        $make = CatalogSlugs::make($slug) ?? Make::query()->whereRaw('lower(name) = ?', [mb_strtolower(trim($value))])->first();

        /** @var Make|null $survivor */
        $survivor = $make === null ? null : CatalogSlugs::survivor($make);

        return $survivor !== null && $survivor->getAttribute('active') !== false ? $survivor : null;
    }

    public static function model(Make $make, string $value): ?VehicleModel
    {
        $model = CatalogSlugs::model($make, Str::slug($value))
            ?? VehicleModel::query()->where('make_id', $make->getKey())->whereRaw('lower(name) = ?', [mb_strtolower(trim($value))])->first();

        /** @var VehicleModel|null $survivor */
        $survivor = $model === null ? null : CatalogSlugs::survivor($model);

        return $survivor;
    }

    public static function generation(VehicleModel $model, string $value): ?Generation
    {
        $generation = CatalogSlugs::generation($model, Str::slug($value))
            ?? Generation::query()->where('model_id', $model->getKey())->whereRaw('lower(name) = ?', [mb_strtolower(trim($value))])->first();

        /** @var Generation|null $survivor */
        $survivor = $generation === null ? null : CatalogSlugs::survivor($generation);

        return $survivor;
    }

    public static function brand(string $value): ?Brand
    {
        $value = trim($value);

        if ($value === '') {
            return null;
        }

        $brand = Brand::query()->where('slug', Str::slug($value))->first()
            ?? Brand::query()->whereRaw('lower(name) = ?', [mb_strtolower($value)])->first()
            ?? Brand::query()->whereJsonContains('aliases', $value)->first();

        /** @var Brand|null $survivor */
        $survivor = $brand === null ? null : CatalogSlugs::survivor($brand);

        return $survivor;
    }
}
