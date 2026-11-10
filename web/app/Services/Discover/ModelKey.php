<?php

namespace App\Services\Discover;

use App\Models\Make;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogSlugs;

/**
 * The route key of a model page (DISC-04): "{make-slug}--{model-slug}", as "bmw--m4". vehicle_models.slug is unique only per make
 * (unique (make_id, slug); "gt", "coupe", "308" and four more exist under two or three makes), so the model slug alone cannot name a
 * page. Catalogue slugs never hold two dashes in a row (App\Support\Slug), so the split is unambiguous.
 */
final class ModelKey
{
    public const SEPARATOR = '--';

    public static function of(VehicleModel $model, ?Make $make = null): string
    {
        $make ??= $model->make;

        return $make?->getAttribute('slug').self::SEPARATOR.$model->getAttribute('slug');
    }

    /**
     * The model the key names, with its make; after a merge (M3.3) an old key answers the survivor, so callers compare
     * of($model) with the key they were given to redirect to the canonical one.
     */
    public static function find(string $key): ?VehicleModel
    {
        return CatalogSlugs::modelKey($key);
    }
}
