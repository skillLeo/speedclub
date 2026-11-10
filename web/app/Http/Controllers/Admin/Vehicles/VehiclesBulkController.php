<?php

namespace App\Http\Controllers\Admin\Vehicles;

use App\Actions\Admin\Vehicles\BulkHideVehicles;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Admin\Vehicles\Requests\BulkHideVehiclesRequest;
use App\Http\Controllers\Controller;
use App\Services\Moderation\Statement;
use Illuminate\Http\RedirectResponse;

/**
 * ADM-11 bulk hide: up to 100 vehicles at once (one remove_content decision each, owners told); more become one approval request
 * (`vehicles.bulk_hide`, four-eyes). The per-record rows go back in the session for the result panel.
 */
class VehiclesBulkController extends Controller
{
    public const FLASH = 'vehicles_bulk';

    public function __invoke(BulkHideVehiclesRequest $request, BulkHideVehicles $bulk): RedirectResponse
    {
        $outcome = $bulk->handle($request->staff(), (array) $request->validated('ids'), Statement::fromArray($request->validated()), $request->reason());

        if ($outcome->approval !== null) {
            return back(303)->with('approval', ApprovalsGateway::flash($outcome->approval));
        }

        $back = back(303)->with(self::FLASH, ['rows' => $outcome->rows]);

        return $outcome->counts()['failed'] === 0 ? $back->with('success', 'vehicles.flash.bulk_done') : $back->with('error', 'vehicles.flash.bulk_partial');
    }
}
