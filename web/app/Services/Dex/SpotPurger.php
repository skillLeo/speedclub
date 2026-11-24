<?php

namespace App\Services\Dex;

use App\Models\Spot;
use App\Models\User;
use App\Models\UserSetProgress;
use App\Models\Vehicle;
use App\Models\VehicleSpotStat;

/**
 * Account deletion (m5.9b contract §0): the spots the member made and the spots of the member's cars go at once, with the member's set
 * progress and their cars' stats; the stats of the other cars the member spotted are recomputed. The hard delete repeats it through the
 * foreign keys (cascade). Other spotters' set progress follows at the nightly repair (part 2): their Dex reads live and already drops
 * the deleted member's cars.
 */
final class SpotPurger
{
    public function __construct(private readonly SpotStats $stats) {}

    /**
     * Inside the caller's transaction. Returns how many spots went.
     */
    public function forMember(User $user): int
    {
        $own = Vehicle::withTrashed()->where('owner_id', $user->id)->pluck('id')->map(strval(...))->all();
        $spotted = Spot::withTrashed()->where('spotter_id', $user->id)->distinct()->pluck('vehicle_id')->map(strval(...))->all();

        $deleted = Spot::withTrashed()
            ->where(fn ($query) => $query->where('spotter_id', $user->id)->orWhereIn('vehicle_id', $own))
            ->forceDelete();

        UserSetProgress::query()->where('user_id', $user->id)->delete();
        VehicleSpotStat::query()->whereIn('vehicle_id', $own)->delete();
        $this->stats->recomputeMany(array_values(array_diff($spotted, $own)));

        return is_int($deleted) ? $deleted : 0;
    }
}
