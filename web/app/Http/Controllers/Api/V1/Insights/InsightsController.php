<?php

namespace App\Http\Controllers\Api\V1\Insights;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Insights\InsightsResource;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Insights\Insights;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * @tags Insights
 */
class InsightsController extends Controller
{
    /**
     * My statistics (INS-01 from Profil).
     *
     * M5.7 (10 §6.1): views of the profile and every car of the member, this week against last week, 30 days, sources, sticker scans,
     * spots, new followers, saves and reactions. Sums only, never who viewed. Owner-only: staff in view-as get 403 view_as_read_only.
     * 404 feature_disabled while the flag `insights` is off.
     */
    public function account(Request $request, Insights $insights): InsightsResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('viewInsights', $user);

        return new InsightsResource($insights->forAccount($user));
    }

    /**
     * A car's statistics (INS-01 from the owner's vehicle).
     *
     * M5.7 (10 §6.1): the same report for one car. Only its owner: 403 forbidden for anybody else, 403 view_as_read_only for staff in
     * view-as.
     */
    public function vehicle(Request $request, Vehicle $vehicle, Insights $insights): InsightsResource
    {
        Gate::authorize('viewInsights', $vehicle);

        return new InsightsResource($insights->forVehicle($vehicle));
    }
}
