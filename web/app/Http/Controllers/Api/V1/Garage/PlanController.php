<?php

namespace App\Http\Controllers\Api\V1\Garage;

use App\Actions\Garage\MarkModificationInstalled;
use App\Actions\Garage\ReorderPlans;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Garage\InstallModificationRequest;
use App\Http\Requests\Api\V1\Garage\ReorderModificationsRequest;
use App\Http\Resources\V1\ModificationRowResource;
use App\Http\Resources\V1\SavedModificationResource;
use App\Models\Modification;
use App\Models\Vehicle;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * M5.3 "Pläne" of VEH-01 (10 §5.9, m5.3-contract §4). A plan is a modification with status `planned`: it is created and edited
 * through the mods routes (target_month, priority, budget_cents); here are what only plans have.
 */
class PlanController extends Controller
{
    private const RELATIONS = ['category.fields', 'brand.mergedInto', 'media', 'vehicle', 'product.brand', 'installedBy.owner'];

    /**
     * Mark a planned modification as installed.
     *
     * "Als verbaut markieren": status `installed`, `installed_on` this month unless sent (YYYY-MM, not in the future), the plan fields
     * cleared, the private budget kept. Verlauf records the change like any status change (`history_recorded`). Accepts an
     * Idempotency-Key header. 409 `mod_not_planned` when the mod is not planned (any more).
     */
    public function install(InstallModificationRequest $request, Modification $modification, MarkModificationInstalled $action): SavedModificationResource
    {
        Gate::authorize('update', $modification);

        /** @var array{installed_on?: string|null, cost_cents?: int|null} $attributes */
        $attributes = $request->validated();

        $saved = $action->handle($modification, $attributes);

        return new SavedModificationResource($saved->modification->refresh()->load(self::RELATIONS), $saved->historyRecorded);
    }

    /**
     * Reorder a vehicle's plans.
     *
     * `ids` must hold every planned modification of the vehicle exactly once (422 under `ids` otherwise). Answers the plans in their
     * new order. The build sheet's order (PUT vehicles/{id}/mods/order) stays as it is.
     */
    public function reorder(ReorderModificationsRequest $request, Vehicle $vehicle, ReorderPlans $action): AnonymousResourceCollection
    {
        Gate::authorize('update', $vehicle);

        /** @var list<string> $ids */
        $ids = $request->validated('ids');

        $plans = $action->handle($vehicle, $ids);
        ModificationRowResource::loadLinks($plans);

        return ModificationRowResource::collection($plans);
    }
}
