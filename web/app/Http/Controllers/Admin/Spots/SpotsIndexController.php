<?php

namespace App\Http\Controllers\Admin\Spots;

use App\Actions\Admin\Moderation\RemoveSpots;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Spot;
use App\Models\Staff;
use App\Services\Admin\Spots\SpotSignals;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-62 Spots (M5.9b admin, m5.9b contract §7; under Moderation): every STREET DEX spot, newest first, with spotter, car (+ Dex number),
 * city, counted, night and source, and the abuse signals as badges (SpotSignals: burst, shared device, impossible city hopping).
 * moderation.view to read; "Spot entfernen" (row, bulk for a burst) needs moderation.decide (ADR-437 a). Cities only, never a place.
 */
class SpotsIndexController extends Controller
{
    public function __invoke(Request $request, SpotSignals $signals): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $query = SpotListQuery::build($request, $signals);

        return Inertia::render('Spots/Index', [
            ...TableProps::make($query, $request, SpotListQuery::TABLE, $staff, fn (array $spots): array => SpotListQuery::rows($spots, $signals), SpotListQuery::DEFAULT_SORT),
            'signals' => fn (): array => [
                'device_available' => $signals->devicesAvailable(),
                'burst' => ['more_than' => SpotSignals::BURST_MORE_THAN, 'minutes' => intdiv(SpotSignals::BURST_SECONDS, 60)],
                'hop' => ['km' => SpotSignals::HOP_KM, 'minutes' => intdiv(SpotSignals::HOP_SECONDS, 60)],
            ],
            'canRemove' => $staff->can('moderation.decide'),
            'bulkMax' => RemoveSpots::MAX_BULK,
            'anySpots' => fn (): bool => Spot::withTrashed()->exists(),
            'bulkResult' => fn (): ?array => self::bulkResult($request),
        ]);
    }

    /**
     * @return array{rows: list<array{id: string, ok: bool, code: string|null}>}|null
     */
    private static function bulkResult(Request $request): ?array
    {
        $result = $request->hasSession() ? $request->session()->get(SpotActionsController::FLASH) : null;

        if (! is_array($result) || ! is_array($result['rows'] ?? null)) {
            return null;
        }

        /** @var list<array{id: string, ok: bool, code: string|null}> $rows */
        $rows = $result['rows'];

        return ['rows' => $rows];
    }
}
