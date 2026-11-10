<?php

namespace App\Http\Controllers\Admin\Vehicles;

use App\Actions\Admin\Vehicles\DeleteVehicleAsStaff;
use App\Actions\Admin\Vehicles\EditVehicle;
use App\Actions\Admin\Vehicles\HideVehicle;
use App\Actions\Admin\Vehicles\UnhideVehicle;
use App\Http\Controllers\Admin\Vehicles\Requests\DeleteVehicleRequest;
use App\Http\Controllers\Admin\Vehicles\Requests\EditVehicleRequest;
use App\Http\Controllers\Admin\Vehicles\Requests\HideVehicleRequest;
use App\Http\Controllers\Admin\Vehicles\Requests\UnhideVehicleRequest;
use App\Http\Controllers\Controller;
use App\Models\Vehicle;
use App\Services\Moderation\Statement;
use Closure;
use DomainException;
use Illuminate\Http\RedirectResponse;
use InvalidArgumentException;

/**
 * ADM-12 actions (m3.2-contract §2), all behind a recent password: hide and unhide are DSA decisions with the owner told (HideVehicle,
 * UnhideVehicle), edit relinks the catalogue, delete records a removal decision and runs the owner's own delete (ADR-225).
 */
class VehicleActionsController extends Controller
{
    public function hide(HideVehicleRequest $request, Vehicle $vehicle, HideVehicle $hide): RedirectResponse
    {
        return $this->run(fn () => $hide->handle($request->staff(), $vehicle, Statement::fromArray($request->validated()), $request->reason()), 'vehicles.flash.hidden');
    }

    public function unhide(UnhideVehicleRequest $request, Vehicle $vehicle, UnhideVehicle $unhide): RedirectResponse
    {
        return $this->run(fn () => $unhide->handle($request->staff(), $vehicle, trim($request->string('facts')->value()), $request->reason()), 'vehicles.flash.unhidden');
    }

    public function update(EditVehicleRequest $request, Vehicle $vehicle, EditVehicle $edit): RedirectResponse
    {
        /** @var array<string, mixed> $changes */
        $changes = $request->safe()->only(EditVehicle::FIELDS);

        return $this->run(fn () => $edit->handle($request->staff(), $vehicle, $changes, $request->reason()), 'vehicles.flash.edited');
    }

    public function destroy(DeleteVehicleRequest $request, Vehicle $vehicle, DeleteVehicleAsStaff $delete): RedirectResponse
    {
        try {
            $delete->handle($request->staff(), $vehicle, Statement::fromArray($request->validated()), $request->reason());
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'vehicles.flash.not_possible');
        }

        return redirect()->route('admin.vehicles.index')->setStatusCode(303)->with('success', 'vehicles.flash.deleted');
    }

    /**
     * @param  Closure(): mixed  $action
     */
    private function run(Closure $action, string $flash): RedirectResponse
    {
        try {
            $action();
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'vehicles.flash.not_possible');
        }

        return back(303)->with('success', $flash);
    }
}
