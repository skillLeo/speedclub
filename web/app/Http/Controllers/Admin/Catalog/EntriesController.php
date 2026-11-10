<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Actions\Admin\Catalog\CreateCatalogEntry;
use App\Actions\Admin\Catalog\DeleteCatalogEntry;
use App\Actions\Admin\Catalog\MergeCatalogEntries;
use App\Actions\Admin\Catalog\SetCatalogEntryActive;
use App\Actions\Admin\Catalog\UpdateCatalogEntry;
use App\Enums\CatalogLevel;
use App\Http\Controllers\Admin\Catalog\Requests\ActiveRequest;
use App\Http\Controllers\Admin\Catalog\Requests\EntryRequest;
use App\Http\Controllers\Admin\Catalog\Requests\MergeRequest;
use App\Http\Controllers\Admin\Catalog\Requests\ReasonedCatalogRequest;
use App\Http\Controllers\Admin\Catalog\Support\Refusals;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogMerger;
use App\Services\Catalog\CatalogReferences;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;

/**
 * ADM-14 / ADM-16 entry writes (m3.3-contract §2, all `catalog.manage`): create, edit, deactivate/activate (reason), merge (⚿, reason,
 * four-eyes above 100 affected vehicles inside the Action: the answer is then the approval flash), delete when unreferenced (⚿, reason,
 * typed confirmation on the page). `impact` (catalog.view) is what the merge and delete dialogs show before anything happens: what
 * points at the entry, whether its slug is locked, and the survivors it may merge into with their vehicle counts.
 */
class EntriesController extends Controller
{
    public function impact(string $level, int $id): JsonResponse
    {
        $level = CatalogLevel::from($level);
        $entry = $this->find($level, $id);
        $references = CatalogReferences::forDelete($entry);
        $children = ['models' => 0, 'generations' => 0];

        if (! $entry instanceof Brand) {
            [, $models, $generations] = CatalogReferences::subtree($entry);
            $children = [
                'models' => $entry instanceof Make ? count($models) : 0,
                'generations' => $entry instanceof Generation ? 0 : count($generations),
            ];
        }

        $merged = $entry->getAttribute('merged_into_id');

        return response()->json([
            'entry' => [
                'id' => (int) $entry->getKey(),
                'level' => $level->value,
                'name' => (string) $entry->getAttribute('name'),
                'slug' => (string) $entry->getAttribute('slug'),
                'merged' => $merged !== null,
                'vehicles' => CatalogReferences::vehicles($level, (int) $entry->getKey()),
                'modifications' => $entry instanceof Brand ? CatalogReferences::modifications((int) $entry->getKey()) : null,
            ],
            'references' => $references,
            'deletable' => array_sum($references) === 0,
            'slug_locked' => array_sum($references) > 0,
            'children' => $children,
            'candidates' => $merged === null ? $this->candidates($level, $entry) : [],
        ]);
    }

    public function store(EntryRequest $request, string $level, CreateCatalogEntry $create): RedirectResponse
    {
        return Refusals::answer(function () use ($request, $create): RedirectResponse {
            $create->handle($request->staff(), $request->level(), $request->values(), $request->reason());

            return back(303)->with('success', 'catalog.flash.created');
        });
    }

    public function update(EntryRequest $request, string $level, int $id, UpdateCatalogEntry $update): RedirectResponse
    {
        $entry = $this->find($request->level(), $id);

        return Refusals::answer(function () use ($request, $entry, $update): RedirectResponse {
            $update->handle($request->staff(), $entry, $request->values(), $request->reason());

            return back(303)->with('success', 'catalog.flash.updated');
        });
    }

    public function active(ActiveRequest $request, string $level, int $id, SetCatalogEntryActive $set): RedirectResponse
    {
        $entry = $this->find($request->level(), $id);
        abort_if($entry instanceof Brand, 404);
        $active = $request->boolean('active');

        return Refusals::answer(function () use ($request, $entry, $set, $active): RedirectResponse {
            $set->handle($request->staff(), $entry, $active, (string) $request->reason());

            return back(303)->with('success', $active ? 'catalog.flash.activated' : 'catalog.flash.deactivated');
        });
    }

    public function merge(MergeRequest $request, string $level, int $id, MergeCatalogEntries $merge): RedirectResponse
    {
        $this->find($request->level(), $id);

        return Refusals::answer(function () use ($request, $id, $merge): RedirectResponse {
            $outcome = $merge->handle($request->staff(), $request->level(), $id, $request->integer('target_id'), (string) $request->reason());

            return $outcome->approval !== null
                ? back(303)->with('approval', ApprovalsGateway::flash($outcome->approval))
                : back(303)->with('success', 'catalog.flash.merged');
        });
    }

    public function destroy(ReasonedCatalogRequest $request, string $level, int $id, DeleteCatalogEntry $delete): RedirectResponse
    {
        $entry = $this->find($request->level(), $id);
        // From the entry's own page there is nothing to go back to: the list or the parent's page.
        $after = $request->input('from') === 'record' ? $this->parentUrl($entry) : null;

        return Refusals::answer(function () use ($request, $entry, $delete, $after): RedirectResponse {
            $delete->handle($request->staff(), $entry, (string) $request->reason());

            return ($after === null ? back(303) : redirect($after, 303))->with('success', 'catalog.flash.deleted');
        });
    }

    private function find(CatalogLevel $level, int $id): Make|VehicleModel|Generation|Brand
    {
        $row = CatalogMerger::modelClass($level)::query()->find($id);
        abort_if($row === null, 404);

        return $row;
    }

    private function parentUrl(Make|VehicleModel|Generation|Brand $entry): string
    {
        return match (true) {
            $entry instanceof VehicleModel => route('admin.catalog.vehicles.make', ['make' => (int) $entry->getAttribute('make_id')]),
            $entry instanceof Generation => route('admin.catalog.vehicles.model', ['model' => (int) $entry->getAttribute('model_id')]),
            $entry instanceof Brand => route('admin.catalog.brands'),
            default => route('admin.catalog.vehicles.makes'),
        };
    }

    /**
     * The entries the source may merge into: the same level, not merged, under the same make (models) or model (generations), each
     * with the vehicles it has now; by name, then id.
     *
     * @return list<array{id: int, name: string, slug: string, active: bool, vehicles: int}>
     */
    private function candidates(CatalogLevel $level, Make|VehicleModel|Generation|Brand $entry): array
    {
        $query = CatalogMerger::modelClass($level)::query()->whereNull('merged_into_id')->whereKeyNot($entry->getKey());

        if ($entry instanceof VehicleModel) {
            $query->where('make_id', $entry->getAttribute('make_id'));
        } elseif ($entry instanceof Generation) {
            $query->where('model_id', $entry->getAttribute('model_id'));
        }

        $rows = $query->orderBy('name')->orderBy('id')->limit(1000)->get();
        $ids = $rows->pluck('id')->all();

        $vehicles = $level === CatalogLevel::Brand
            ? Modification::withTrashed()->whereIn('brand_id', $ids ?: [0])->groupBy('brand_id')->selectRaw('brand_id AS k, COUNT(DISTINCT vehicle_id) AS c')->toBase()->pluck('c', 'k')->all()
            : Vehicle::withTrashed()->whereIn((string) $level->vehicleColumn(), $ids ?: [0])->groupBy((string) $level->vehicleColumn())
                ->selectRaw(match ($level) {
                    CatalogLevel::Make => 'make_id AS k, COUNT(*) AS c',
                    CatalogLevel::Model => 'model_id AS k, COUNT(*) AS c',
                    default => 'generation_id AS k, COUNT(*) AS c',
                })->toBase()->pluck('c', 'k')->all();

        return array_values($rows->map(fn (Make|VehicleModel|Generation|Brand $row): array => [
            'id' => (int) $row->getKey(),
            'name' => (string) $row->getAttribute('name'),
            'slug' => (string) $row->getAttribute('slug'),
            'active' => (bool) ($row->getAttribute('active') ?? true),
            'vehicles' => (int) ($vehicles[$row->getKey()] ?? 0),
        ])->all());
    }
}
