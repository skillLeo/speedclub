<?php

namespace App\Jobs\Catalog;

use App\Enums\VehicleStatus;
use App\Models\Vehicle;
use App\Services\Search\RebuildVehicleSearch;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * After a schema change that changes what the search row holds (M3.3, ADM-15): a field's `searchable`, an option, a category's sort
 * (the bit of mod_category_mask) or its active flag. Queues one RebuildVehicleSearch per published vehicle with a modification of the
 * category (every published vehicle when `$categoryId` is 0), by vehicle id, continuing itself after TimeBudget. Each rebuild job is
 * unique per vehicle and idempotent.
 */
class RebuildCategorySearch implements ShouldQueue
{
    use Queueable;

    private const CHUNK = 500;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @param  int  $categoryId  0 for every published vehicle
     * @param  string  $afterVehicleId  where a continuation starts ('' from the first)
     */
    public function __construct(public readonly int $categoryId = 0, public readonly string $afterVehicleId = '') {}

    public function handle(): void
    {
        $budget = new TimeBudget;
        $after = $this->afterVehicleId === '' ? null : $this->afterVehicleId;

        while (true) {
            $ids = Vehicle::query()
                ->where('status', VehicleStatus::Published)
                ->when($this->categoryId !== 0, fn ($query) => $query->whereHas('modifications', fn ($mods) => $mods->where('category_id', $this->categoryId)))
                ->when($after !== null, fn ($query) => $query->where('id', '>', $after))
                ->orderBy('id')
                ->limit(self::CHUNK)
                ->pluck('id')
                ->all();

            foreach ($ids as $id) {
                RebuildVehicleSearch::dispatch((string) $id);
                $after = (string) $id;
            }

            if (count($ids) < self::CHUNK) {
                break;
            }

            if ($budget->spent()) {
                self::dispatch($this->categoryId, $after);
                break;
            }
        }
    }
}
