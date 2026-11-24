<?php

namespace App\Http\Controllers\Api\V1\Dex;

use App\Enums\Visibility;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\SpotCardResource;
use App\Http\Resources\V1\SpotStatsResource;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Dex\OwnerSpotStats;
use App\Services\Dex\SpotCards;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * DEX-04 card and DEX-06 owner numbers of one car (m5.9b contract §3, §4).
 */
class DexCardController extends Controller
{
    /**
     * A car's Dex card.
     *
     * The card of a car I spotted (`spotted` true), else the "noch nicht gespottet" preview of a public car that is not in ghost mode
     * (`spotted` false, no spot data). 404 otherwise, also for a car I may not see.
     */
    public function show(Request $request, Vehicle $vehicle, SpotCards $cards): SpotCardResource
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless(Gate::allows('viewDexCard', $vehicle), 404);

        $spot = $cards->firstSpotOf($user, $vehicle);

        if ($spot !== null) {
            return new SpotCardResource($cards->forSpot($user, $spot));
        }

        abort_unless($vehicle->isOwnedBy($user) || ($vehicle->visibility === Visibility::Public && ! $vehicle->ghost_mode), 404);

        return new SpotCardResource($cards->preview($vehicle));
    }

    /**
     * My car's spot numbers.
     *
     * Owner only (403 for anybody else). Counted spots; cities of day spots only and none while `hide_spot_cities` is on; the last 30
     * days by day; recent spotters, `{anonymous: true}` for those who keep "Meine Spots zeigen" off; the Street Famous tier.
     */
    public function stats(Vehicle $vehicle, OwnerSpotStats $stats): SpotStatsResource
    {
        Gate::authorize('viewSpotStats', $vehicle);

        return new SpotStatsResource($stats->for($vehicle));
    }
}
