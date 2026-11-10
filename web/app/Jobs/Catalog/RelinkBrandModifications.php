<?php

namespace App\Jobs\Catalog;

use App\Models\Brand;
use App\Models\Modification;
use App\Services\Catalog\CatalogSlugs;
use App\Services\Search\RebuildVehicleSearch;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

/**
 * After a brand merge or rename (M3.3, ADM-16): every modification of brand `$brandId` (soft-deleted ones too) points at the brand it
 * stands for now, and the vehicles of those modifications get a search rebuild (the brand facets and the words of the search row).
 * Idempotent and resumable like RelinkCatalogVehicles: by modification id, in chunks, continuing itself after TimeBudget. The member's
 * own text in the modification's fields stays as they typed it.
 */
class RelinkBrandModifications implements ShouldQueue
{
    use Queueable;

    private const CHUNK = 200;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [30, 120];

    /**
     * @param  string  $afterModificationId  where a continuation starts ('' from the first)
     */
    public function __construct(public readonly int $brandId, public readonly string $afterModificationId = '') {}

    public function handle(): void
    {
        $budget = new TimeBudget;
        $after = $this->afterModificationId === '' ? null : $this->afterModificationId;
        $survivor = CatalogSlugs::survivorId(Brand::class, $this->brandId);

        while (true) {
            $rows = Modification::withTrashed()
                ->where('brand_id', $this->brandId)
                ->when($after !== null, fn ($query) => $query->where('id', '>', $after))
                ->orderBy('id')
                ->limit(self::CHUNK)
                ->get(['id', 'vehicle_id']);

            if ($rows->isEmpty()) {
                break;
            }

            $ids = $rows->pluck('id')->all();

            if ($survivor !== $this->brandId) {
                DB::table('modifications')->whereIn('id', $ids)->where('brand_id', $this->brandId)->update(['brand_id' => $survivor]);
            }

            foreach ($rows->pluck('vehicle_id')->unique() as $vehicleId) {
                RebuildVehicleSearch::dispatch((string) $vehicleId);
            }

            $after = (string) $rows->last()->getKey();

            if ($rows->count() < self::CHUNK) {
                break;
            }

            if ($budget->spent()) {
                self::dispatch($this->brandId, $after);
                break;
            }
        }
    }
}
