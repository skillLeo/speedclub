<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Enums\CatalogRequestStatus;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\CatalogRequest;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-14 (m3.3-contract §2, catalog.view): the makes table (tab Marken), a make with its models, a model with its generations. Each
 * row says whether it is active or merged (into whom); vehicles count what members built on it (deleted builds in their 30 days
 * included, as CatalogReferences counts them).
 */
class MakesController extends Controller
{
    public function index(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Catalog/Makes', [
            ...TableProps::make(CatalogListQuery::makes($request), $request, CatalogListQuery::MAKES, $staff, fn (array $makes): array => CatalogListQuery::makeRows($makes), CatalogListQuery::MAKES_SORT),
            'counts' => fn (): array => self::tabCounts(),
        ]);
    }

    public function show(int $make): Response
    {
        $row = Make::query()->with('mergedInto:id,name')->find($make);
        abort_if($row === null, 404);

        $models = VehicleModel::query()->where('make_id', $row->getKey())
            ->select('vehicle_models.*')
            ->selectSub(Generation::query()->selectRaw('COUNT(*)')->whereColumn('generations.model_id', 'vehicle_models.id')->whereNull('generations.merged_into_id'), 'generations_count')
            ->selectSub(Vehicle::withTrashed()->selectRaw('COUNT(*)')->whereColumn('vehicles.model_id', 'vehicle_models.id'), 'vehicles_count')
            ->with('mergedInto:id,name')
            ->orderByRaw('merged_into_id IS NOT NULL')->orderBy('name')->orderBy('id')
            ->get();

        return Inertia::render('Catalog/Make', [
            'make' => [
                'id' => (int) $row->getKey(),
                'name' => (string) $row->getAttribute('name'),
                'slug' => (string) $row->getAttribute('slug'),
                'country' => $row->getAttribute('country'),
                'is_popular' => (bool) $row->getAttribute('is_popular'),
                'sort' => (int) $row->getAttribute('sort'),
                'active' => (bool) $row->getAttribute('active'),
                'merged_into' => self::target($row->getRelationValue('mergedInto')),
                'vehicles' => Vehicle::withTrashed()->where('make_id', $row->getKey())->count(),
            ],
            'models' => array_values($models->map(fn (VehicleModel $model): array => [
                'id' => (int) $model->getKey(),
                'make_id' => (int) $model->getAttribute('make_id'),
                'name' => (string) $model->getAttribute('name'),
                'slug' => (string) $model->getAttribute('slug'),
                'active' => (bool) $model->getAttribute('active'),
                'merged_into' => self::target($model->getRelationValue('mergedInto')),
                'generations' => (int) $model->getAttribute('generations_count'),
                'vehicles' => (int) $model->getAttribute('vehicles_count'),
            ])->all()),
        ]);
    }

    public function model(int $model): Response
    {
        $row = VehicleModel::query()->with(['make:id,name', 'mergedInto:id,name'])->find($model);
        abort_if($row === null, 404);

        $generations = Generation::query()->where('model_id', $row->getKey())
            ->select('generations.*')
            ->selectSub(Vehicle::withTrashed()->selectRaw('COUNT(*)')->whereColumn('vehicles.generation_id', 'generations.id'), 'vehicles_count')
            ->with('mergedInto:id,name')
            ->orderByRaw('merged_into_id IS NOT NULL')->orderByRaw('year_from IS NULL')->orderBy('year_from')->orderBy('name')->orderBy('id')
            ->get();

        $make = $row->make;

        return Inertia::render('Catalog/Model', [
            'make' => $make === null ? null : ['id' => (int) $make->getKey(), 'name' => (string) $make->getAttribute('name')],
            'model' => [
                'id' => (int) $row->getKey(),
                'make_id' => (int) $row->getAttribute('make_id'),
                'name' => (string) $row->getAttribute('name'),
                'slug' => (string) $row->getAttribute('slug'),
                'active' => (bool) $row->getAttribute('active'),
                'merged_into' => self::target($row->getRelationValue('mergedInto')),
                'vehicles' => Vehicle::withTrashed()->where('model_id', $row->getKey())->count(),
            ],
            'generations' => array_values($generations->map(fn (Generation $generation): array => [
                'id' => (int) $generation->getKey(),
                'model_id' => (int) $generation->getAttribute('model_id'),
                'name' => (string) $generation->getAttribute('name'),
                'slug' => (string) $generation->getAttribute('slug'),
                'year_from' => $generation->getAttribute('year_from'),
                'year_to' => $generation->getAttribute('year_to'),
                'active' => (bool) $generation->getAttribute('active'),
                'merged_into' => self::target($generation->getRelationValue('mergedInto')),
                'vehicles' => (int) $generation->getAttribute('vehicles_count'),
            ])->all()),
        ]);
    }

    /**
     * Tab counts of ADM-14: makes (not merged) and the open member requests.
     *
     * @return array{makes: int, requests: int}
     */
    public static function tabCounts(): array
    {
        return [
            'makes' => Make::query()->whereNull('merged_into_id')->count(),
            'requests' => CatalogRequest::query()->where('status', CatalogRequestStatus::Pending)->count(),
        ];
    }

    /**
     * @return array{id: int, name: string}|null
     */
    private static function target(mixed $row): ?array
    {
        return $row instanceof Make || $row instanceof VehicleModel || $row instanceof Generation
            ? ['id' => (int) $row->getKey(), 'name' => (string) $row->getAttribute('name')]
            : null;
    }
}
