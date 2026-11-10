<?php

namespace App\Jobs\Catalog;

use App\Enums\CatalogLevel;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogSlugs;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * After a merge or a rename of a make, model or generation (M3.3): every vehicle that points at the entry gets the catalogue ids the
 * rows stand for now (a merged row answers its survivor; the make follows the model, the model the generation), the slug of the new
 * names (an old /v/ URL answers 301 through its public id) and a search rebuild (vehicle_search and its facets, after the commit).
 * Deleted vehicles in their 30 days are relinked too: their foreign keys must not hold a merged row.
 *
 * Idempotent: it reads the merge from the rows, so a second run finds nothing to change. Resumable: by vehicle id, one short
 * transaction per vehicle under its row lock (the lock a search rebuild takes as well), and after TimeBudget it queues its own
 * continuation from the last id.
 */
class RelinkCatalogVehicles implements ShouldQueue
{
    use Queueable;

    public const COLUMNS = ['make' => 'make_id', 'model' => 'model_id', 'generation' => 'generation_id'];

    private const CHUNK = 100;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [30, 120];

    private readonly string $column;

    private readonly int $id;

    /**
     * @param  string  $entryId  the entry as "{level}:{id}" ("make:12", "model:7", "generation:3"), see entry()
     * @param  string  $afterVehicleId  where a continuation starts ('' from the first vehicle)
     */
    public function __construct(public readonly string $entryId, public readonly string $afterVehicleId = '')
    {
        [$level, $id] = array_pad(explode(':', $entryId, 2), 2, '');

        if (! isset(self::COLUMNS[$level]) || ! ctype_digit($id)) {
            throw new InvalidArgumentException("Unknown catalogue entry [$entryId].");
        }

        $this->column = self::COLUMNS[$level];
        $this->id = (int) $id;
    }

    public static function entry(CatalogLevel $level, int $id): string
    {
        return $level->value.':'.$id;
    }

    public function handle(VehicleSearchProjector $search, SitemapWriter $sitemap): void
    {
        $budget = new TimeBudget;
        $after = $this->afterVehicleId === '' ? null : $this->afterVehicleId;
        $slugsChanged = false;

        while (true) {
            $ids = Vehicle::withTrashed()
                ->where($this->column, $this->id)
                ->when($after !== null, fn ($query) => $query->where('id', '>', $after))
                ->orderBy('id')
                ->limit(self::CHUNK)
                ->pluck('id')
                ->all();

            foreach ($ids as $vehicleId) {
                $slugsChanged = $this->relink((string) $vehicleId, $search) || $slugsChanged;
                $after = (string) $vehicleId;
            }

            if (count($ids) < self::CHUNK) {
                break;
            }

            if ($budget->spent()) {
                self::dispatch($this->entryId, $after);
                break;
            }
        }

        if ($slugsChanged) {
            $sitemap->forget();
        }
    }

    /**
     * @return bool whether the public slug changed
     */
    private function relink(string $vehicleId, VehicleSearchProjector $search): bool
    {
        return DB::transaction(function () use ($vehicleId, $search): bool {
            $vehicle = Vehicle::withTrashed()->whereKey($vehicleId)->lockForUpdate()->first();

            if ($vehicle === null) {
                return false;
            }

            $ids = self::canonicalIds(
                self::intOrNull($vehicle->getAttribute('make_id')),
                self::intOrNull($vehicle->getAttribute('model_id')),
                self::intOrNull($vehicle->getAttribute('generation_id')),
            );

            $vehicle->forceFill($ids);
            $vehicle->unsetRelations();
            $slug = $vehicle->canonicalSlug();
            $slugChanged = $slug !== $vehicle->slug;
            $vehicle->forceFill(['slug' => $slug]);

            if ($vehicle->isDirty()) {
                // A catalogue change is not a change of the build: "Zuletzt aktualisiert" stays.
                $vehicle->timestamps = false;
                $vehicle->saveQuietly();
            }

            // Rebuilt either way: a rename changes the words of the search row without changing an id.
            $search->queue($vehicle);

            return $slugChanged;
        });
    }

    /**
     * The ids a vehicle's make, model and generation stand for now: survivors of merges, the model's make and the generation's model.
     *
     * @return array{make_id: int|null, model_id: int|null, generation_id: int|null}
     */
    public static function canonicalIds(?int $makeId, ?int $modelId, ?int $generationId): array
    {
        $generationId = CatalogSlugs::survivorId(Generation::class, $generationId);
        $modelId = CatalogSlugs::survivorId(VehicleModel::class, $modelId);

        if ($generationId !== null) {
            $parent = Generation::query()->whereKey($generationId)->value('model_id');
            $modelId = $parent === null ? $modelId : (int) $parent;
        }

        $makeId = CatalogSlugs::survivorId(Make::class, $makeId);

        if ($modelId !== null) {
            $parent = VehicleModel::query()->whereKey($modelId)->value('make_id');
            $makeId = $parent === null ? $makeId : (int) $parent;
        }

        return ['make_id' => $makeId, 'model_id' => $modelId, 'generation_id' => $generationId];
    }

    private static function intOrNull(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }
}
