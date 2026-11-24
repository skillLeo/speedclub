<?php

namespace App\Http\Controllers\Admin\Spots;

use App\Actions\Admin\Moderation\RemoveSpots;
use App\Http\Controllers\Admin\Spots\Requests\BulkRemoveSpotsRequest;
use App\Http\Controllers\Admin\Spots\Requests\RemoveSpotRequest;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * ADM-62 writes: "Spot entfernen" for one spot and for a selection (a burst, ≤ 50). Thin: RemoveSpots removes, recomputes and audits.
 * Answers: an Inertia visit goes back with `spots.flash.removed` (or `spots.flash.already` for a spot removed before: idempotent), a bulk
 * run with the per-spot result rows (`spots_bulk`); a JSON client gets {removed, id} or the rows.
 */
class SpotActionsController extends Controller
{
    public const FLASH = 'spots_bulk';

    public function remove(RemoveSpotRequest $request, string $spot, RemoveSpots $remove): RedirectResponse|JsonResponse
    {
        $result = $remove->one($request->staff(), $spot, $request->reason());
        abort_if($result === null, 404);

        if (self::json($request)) {
            return response()->json(['id' => $result['spot']->id, 'removed' => $result['removed']]);
        }

        return back(303)->with('success', $result['removed'] ? 'spots.flash.removed' : 'spots.flash.already');
    }

    public function bulk(BulkRemoveSpotsRequest $request, RemoveSpots $remove): RedirectResponse|JsonResponse
    {
        $rows = $remove->many($request->staff(), $request->ids(), $request->reason());
        $failed = count(array_filter($rows, fn (array $row): bool => ! $row['ok']));

        if (self::json($request)) {
            return response()->json(['rows' => $rows]);
        }

        return back(303)->with(self::FLASH, ['rows' => $rows])->with($failed === 0 ? 'success' : 'error', $failed === 0 ? 'spots.flash.bulk_done' : 'spots.flash.bulk_partial');
    }

    private static function json(Request $request): bool
    {
        return $request->expectsJson() && ! $request->hasHeader('X-Inertia');
    }
}
