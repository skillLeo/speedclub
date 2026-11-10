<?php

namespace App\Http\Controllers\Admin\Vehicles;

use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Make;
use App\Models\Staff;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** ADM-11 vehicles list (06 §3 Vehicles & media): server table, filters, bulk hide with the per-record result panel. */
class VehiclesIndexController extends Controller
{
    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Vehicles/Index', [
            ...TableProps::make(VehicleListQuery::build($request), $request, VehicleListQuery::TABLE, $staff, fn (array $vehicles): array => VehicleListQuery::rows($vehicles), VehicleListQuery::DEFAULT_SORT),
            'makes' => fn (): array => Make::query()->whereIn('id', Vehicle::query()->whereNotNull('make_id')->distinct()->select('make_id'))
                ->orderBy('name')->get(['id', 'name'])->map(fn (Make $make): array => ['value' => (string) $make->id, 'label' => $make->name])->values()->all(),
            'bulkResult' => fn (): ?array => self::bulkResult($request),
        ]);
    }

    /**
     * @return array{action: string, rows: list<array{id: string, ok: bool, code: string|null}>, labels: array<string, string>}|null
     */
    private static function bulkResult(Request $request): ?array
    {
        $result = $request->hasSession() ? $request->session()->get(VehiclesBulkController::FLASH) : null;

        if (! is_array($result) || ! is_array($result['rows'] ?? null)) {
            return null;
        }

        /** @var list<array{id: string, ok: bool, code: string|null}> $rows */
        $rows = array_values($result['rows']);
        $labels = Vehicle::withTrashed()->whereIn('id', array_column($rows, 'id'))->get(['id', 'slug'])
            ->mapWithKeys(fn (Vehicle $v): array => [$v->id => $v->slug])->all();

        return ['action' => 'hide', 'rows' => $rows, 'labels' => $labels];
    }
}
