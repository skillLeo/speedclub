<?php

namespace App\Services\Dex;

use App\Models\Spot;
use App\Models\VehicleSpotStat;
use Illuminate\Support\Facades\DB;

/**
 * vehicle_spot_stats (m5.9b contract §1, §4): recomputed from the car's spots after each counted spot and after removals, so a run
 * twice or out of order ends in the same place (the nightly repair of part 2 calls the same method). Counted, not-removed spots only;
 * cities_count counts the cities of day spots (a night spot never names its city for a single car).
 */
final class SpotStats
{
    public function recompute(string $vehicleId): VehicleSpotStat
    {
        $counted = Spot::query()->toBase()->where('vehicle_id', $vehicleId)->where('counted', true)->whereNull('deleted_at');

        /** @var object{total: int|string|null, spotters: int|string|null, last_at: string|null}|null $row */
        $row = (clone $counted)->selectRaw('COUNT(*) as total, COUNT(DISTINCT spotter_id) as spotters, MAX(created_at) as last_at')->first();
        $cities = (clone $counted)->where('is_night', false)->whereNotNull('city_id')->distinct()->count('city_id');
        $spotters = (int) ($row->spotters ?? 0);

        $values = [
            'total' => (int) ($row->total ?? 0),
            'unique_spotters' => $spotters,
            'cities_count' => $cities,
            'last_spot_at' => $row->last_at ?? null,
            'street_famous_tier' => self::tier($spotters),
            'updated_at' => now(),
        ];

        DB::table('vehicle_spot_stats')->upsert([['vehicle_id' => $vehicleId, ...$values]], ['vehicle_id'], array_keys($values));

        return VehicleSpotStat::query()->findOrFail($vehicleId);
    }

    /**
     * @param  iterable<string>  $vehicleIds
     */
    public function recomputeMany(iterable $vehicleIds): void
    {
        foreach ($vehicleIds as $id) {
            $this->recompute($id);
        }
    }

    /**
     * "Street Famous" (contract §4): the highest of 10 / 50 / 100 / 500 the unique spotters reached, or null.
     */
    public static function tier(int $uniqueSpotters): ?int
    {
        $tier = null;

        foreach (config()->array('speedclub.dex.street_famous_tiers') as $threshold) {
            if (is_int($threshold) && $uniqueSpotters >= $threshold) {
                $tier = $threshold;
            }
        }

        return $tier;
    }
}
