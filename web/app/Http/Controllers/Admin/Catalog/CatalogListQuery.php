<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Enums\CatalogRequestStatus;
use App\Models\Brand;
use App\Models\CatalogRequest;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\AllowedSort;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * The server-driven tables of ADM-14 (makes, requests) and ADM-16 (brands): whitelisted filters and sorts (spatie/laravel-query-builder),
 * every sort with the id as tie-breaker so a page never reorders between reloads. Without a status filter merged rows are left out
 * (they are aliases, m3.3 §1; `status=merged` lists them).
 */
final class CatalogListQuery
{
    public const MAKES = 'catalog-makes';

    public const MAKES_SORT = 'name';

    public const REQUESTS = 'catalog-requests';

    public const REQUESTS_SORT = 'created_at';

    public const BRANDS = 'catalog-brands';

    public const BRANDS_SORT = 'name';

    /**
     * @return QueryBuilder<Make>
     */
    public static function makes(Request $request): QueryBuilder
    {
        $base = Make::query()
            ->select('makes.*')
            ->selectSub(VehicleModel::query()->selectRaw('COUNT(*)')->whereColumn('vehicle_models.make_id', 'makes.id')->whereNull('vehicle_models.merged_into_id'), 'models_count')
            ->selectSub(Vehicle::withTrashed()->selectRaw('COUNT(*)')->whereColumn('vehicles.make_id', 'makes.id'), 'vehicles_count')
            ->with('mergedInto:id,name');

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                self::search('makes'),
                self::status('makes'),
                AllowedFilter::callback('popular', fn (Builder $q, mixed $value) => $q->where('makes.is_popular', in_array($value, ['1', 1, true, 'true'], true)))->delimiter("\u{1}"),
            )
            ->allowedSorts('name', 'country', 'sort', AllowedSort::field('models', 'models_count'), AllowedSort::field('vehicles', 'vehicles_count'))
            ->defaultSort(self::MAKES_SORT);

        self::withoutMergedUnlessAsked($query, $request, 'makes');
        $query->getEloquentBuilder()->orderBy('makes.id');

        return $query;
    }

    /**
     * @param  list<Make>  $makes
     * @return list<array<string, mixed>>
     */
    public static function makeRows(array $makes): array
    {
        return array_map(fn (Make $make): array => [
            'id' => (int) $make->getKey(),
            'name' => (string) $make->getAttribute('name'),
            'slug' => (string) $make->getAttribute('slug'),
            'country' => $make->getAttribute('country'),
            'is_popular' => (bool) $make->getAttribute('is_popular'),
            'sort' => (int) $make->getAttribute('sort'),
            'active' => (bool) $make->getAttribute('active'),
            'merged_into' => self::mergedInto($make),
            'models' => (int) $make->getAttribute('models_count'),
            'vehicles' => (int) $make->getAttribute('vehicles_count'),
        ], $makes);
    }

    /**
     * @return QueryBuilder<CatalogRequest>
     */
    public static function requests(Request $request): QueryBuilder
    {
        $base = CatalogRequest::query()
            ->with(['user:id,username', 'vehicle' => fn ($q) => $q->withTrashed()->select(['id', 'slug', 'make_id', 'model_id', 'make_text', 'model_text', 'deleted_at']), 'vehicle.make:id,name', 'vehicle.vehicleModel:id,name', 'resolvedBy:id,name']);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('status', function (Builder $q, mixed $value): void {
                    $status = CatalogRequestStatus::tryFrom(is_string($value) ? $value : '');
                    $q->where('catalog_requests.status', $status === null ? '-' : $status->value);
                })->delimiter("\u{1}"),
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $like = '%'.addcslashes(mb_strtolower(trim(is_string($value) ? $value : '')), '%_\\').'%';
                    $q->where(fn (Builder $w) => $w->where('make_text', 'like', $like)->orWhere('model_text', 'like', $like)->orWhere('generation_text', 'like', $like));
                })->delimiter("\u{1}"),
            )
            ->allowedSorts('created_at', 'resolved_at')
            ->defaultSort(self::REQUESTS_SORT);

        // The queue is what waits: without a status filter, the open requests.
        $filter = $request->query('filter');
        if (! is_array($filter) || ! isset($filter['status'])) {
            $query->getEloquentBuilder()->where('catalog_requests.status', CatalogRequestStatus::Pending->value);
        }
        $query->getEloquentBuilder()->orderBy('catalog_requests.id');

        return $query;
    }

    /**
     * @param  list<CatalogRequest>  $requests
     * @return list<array<string, mixed>>
     */
    public static function requestRows(array $requests): array
    {
        return array_map(function (CatalogRequest $row): array {
            $vehicle = $row->vehicle;

            return [
                'id' => (string) $row->getKey(),
                'make_text' => $row->getAttribute('make_text'),
                'model_text' => $row->getAttribute('model_text'),
                'generation_text' => $row->getAttribute('generation_text'),
                'status' => $row->status->value,
                'member' => $row->user === null ? null : ['id' => (string) $row->user->getKey(), 'username' => $row->user->getAttribute('username')],
                'vehicle' => $vehicle === null ? null : [
                    'id' => (string) $vehicle->getKey(),
                    'title' => trim(($vehicle->make?->getAttribute('name') ?? $vehicle->getAttribute('make_text') ?? '').' '.($vehicle->vehicleModel?->getAttribute('name') ?? $vehicle->getAttribute('model_text') ?? '')),
                    'in_catalog' => $vehicle->getAttribute('make_id') !== null && $vehicle->getAttribute('model_id') !== null,
                    'deleted' => $vehicle->getAttribute('deleted_at') !== null,
                ],
                'rejection_reason' => $row->getAttribute('rejection_reason'),
                'resolved_by' => $row->resolvedBy?->getAttribute('name'),
                'resolved_at' => $row->getAttribute('resolved_at')?->toIso8601String(),
                'created_at' => $row->created_at?->toIso8601String(),
            ];
        }, $requests);
    }

    /**
     * @return QueryBuilder<Brand>
     */
    public static function brands(Request $request): QueryBuilder
    {
        $base = Brand::query()
            ->select('brands.*')
            ->selectSub(Modification::withTrashed()->selectRaw('COUNT(*)')->whereColumn('modifications.brand_id', 'brands.id'), 'usage_count')
            ->with('mergedInto:id,name');

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $text = mb_strtolower(trim(is_string($value) ? $value : ''));
                    $like = '%'.addcslashes($text, '%_\\').'%';
                    $q->where(fn (Builder $w) => $w->where('brands.name', 'like', $like)->orWhere('brands.slug', 'like', $like)->orWhere('brands.aliases', 'like', $like));
                })->delimiter("\u{1}"),
                AllowedFilter::callback('category', fn (Builder $q, mixed $value) => $q->where('brands.category_hint', is_string($value) ? $value : '-'))->delimiter("\u{1}"),
                self::status('brands', withActive: false),
            )
            ->allowedSorts('name', AllowedSort::field('usage', 'usage_count'))
            ->defaultSort(self::BRANDS_SORT);

        self::withoutMergedUnlessAsked($query, $request, 'brands');
        $query->getEloquentBuilder()->orderBy('brands.id');

        return $query;
    }

    /**
     * @param  list<Brand>  $brands
     * @return list<array<string, mixed>>
     */
    public static function brandRows(array $brands): array
    {
        $categories = self::categoryNames();

        return array_map(fn (Brand $brand): array => [
            'id' => (int) $brand->getKey(),
            'name' => (string) $brand->getAttribute('name'),
            'slug' => (string) $brand->getAttribute('slug'),
            'category_hint' => $brand->getAttribute('category_hint'),
            'category' => $categories[(string) $brand->getAttribute('category_hint')] ?? null,
            'aliases' => $brand->aliases ?? [],
            'usage' => (int) $brand->getAttribute('usage_count'),
            'merged_into' => self::mergedInto($brand),
        ], $brands);
    }

    /**
     * Category key → its name in the admin's language.
     *
     * @return array<string, string>
     */
    public static function categoryNames(): array
    {
        return ModCategory::query()->orderBy('sort')->orderBy('id')->get()
            ->mapWithKeys(fn (ModCategory $category): array => [$category->key => (string) $category->getTranslation('name', app()->getLocale() === 'en' ? 'en' : 'de')])
            ->all();
    }

    private static function search(string $table): AllowedFilter
    {
        return AllowedFilter::callback('q', function (Builder $q, mixed $value) use ($table): void {
            $like = '%'.addcslashes(mb_strtolower(trim(is_string($value) ? $value : '')), '%_\\').'%';
            $q->where(fn (Builder $w) => $w->where("$table.name", 'like', $like)->orWhere("$table.slug", 'like', $like));
        })->delimiter("\u{1}");
    }

    private static function status(string $table, bool $withActive = true): AllowedFilter
    {
        return AllowedFilter::callback('status', function (Builder $q, mixed $value) use ($table, $withActive): void {
            match ($value) {
                'merged' => $q->whereNotNull("$table.merged_into_id"),
                'active' => $withActive ? $q->whereNull("$table.merged_into_id")->where("$table.active", true) : $q->whereNull("$table.merged_into_id"),
                'inactive' => $withActive ? $q->whereNull("$table.merged_into_id")->where("$table.active", false) : $q->whereRaw('1 = 0'),
                default => $q->whereRaw('1 = 0'),
            };
        })->delimiter("\u{1}");
    }

    /**
     * @param  QueryBuilder<Make>|QueryBuilder<Brand>  $query
     */
    private static function withoutMergedUnlessAsked(QueryBuilder $query, Request $request, string $table): void
    {
        $filter = $request->query('filter');

        if (! is_array($filter) || ! isset($filter['status'])) {
            $query->getEloquentBuilder()->whereNull("$table.merged_into_id");
        }
    }

    /**
     * @return array{id: int, name: string}|null
     */
    private static function mergedInto(Make|Brand $row): ?array
    {
        $target = $row->getRelationValue('mergedInto');

        return $target instanceof Make || $target instanceof Brand ? ['id' => (int) $target->getKey(), 'name' => (string) $target->getAttribute('name')] : null;
    }
}
