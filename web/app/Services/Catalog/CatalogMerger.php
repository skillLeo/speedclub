<?php

namespace App\Services\Catalog;

use App\Enums\CatalogLevel;
use App\Jobs\Catalog\RelinkBrandModifications;
use App\Jobs\Catalog\RelinkCatalogVehicles;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use Illuminate\Support\Facades\DB;

/**
 * The catalogue part of a merge (m3.3 §1), inside the caller's transaction; the references follow in queued jobs after the commit.
 *
 * - The merged row stays: inactive, `merged_into_id` = survivor, as the alias of its slug (CatalogSlugs). Rows that were merged into it
 *   now point at the survivor too (chains stay one hop).
 * - Make X → Y: every model of X moves to Y; a model whose slug Y already has is merged into that one instead (and so on for its
 *   generations). Model A → B: likewise for the generations of A. Rows merged earlier stay where they are, as aliases.
 * - Brand X → Y: Y takes X's name and aliases as aliases.
 * - Then RelinkCatalogVehicles (vehicles, their slugs and search rows) or RelinkBrandModifications (modifications and their vehicles'
 *   search rows and facets) runs over what still points at X: idempotent and resumable, as it reads the merge from the rows.
 *
 * @phpstan-type MergeCounts array{models_moved: int, models_merged: int, generations_moved: int, generations_merged: int}
 */
final class CatalogMerger
{
    /** @var MergeCounts */
    private array $counts = ['models_moved' => 0, 'models_merged' => 0, 'generations_moved' => 0, 'generations_merged' => 0];

    /**
     * Loads and checks both rows under their locks: the same level, two different entries, neither merged already.
     *
     * @return array{0: Make|VehicleModel|Generation|Brand, 1: Make|VehicleModel|Generation|Brand}
     *
     * @throws CatalogRefused
     */
    public static function lockPair(CatalogLevel $level, int $sourceId, int $targetId): array
    {
        if ($sourceId === $targetId) {
            throw new CatalogRefused('same_entry');
        }

        $class = self::modelClass($level);
        $rows = $class::query()->whereKey([$sourceId, $targetId])->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        $source = $rows->get($sourceId);
        $target = $rows->get($targetId);

        if ($source === null || $target === null) {
            throw new CatalogRefused('not_found');
        }

        if ($source->getAttribute('merged_into_id') !== null || $target->getAttribute('merged_into_id') !== null) {
            throw new CatalogRefused('merged');
        }

        /** @var Make|VehicleModel|Generation|Brand $source */
        /** @var Make|VehicleModel|Generation|Brand $target */
        return [$source, $target];
    }

    /**
     * @param  Make|VehicleModel|Generation|Brand  $source  locked
     * @param  Make|VehicleModel|Generation|Brand  $target  locked
     * @return MergeCounts
     */
    public function merge(Make|VehicleModel|Generation|Brand $source, Make|VehicleModel|Generation|Brand $target): array
    {
        $this->counts = ['models_moved' => 0, 'models_merged' => 0, 'generations_moved' => 0, 'generations_merged' => 0];

        match (true) {
            $source instanceof Make && $target instanceof Make => $this->makes($source, $target),
            $source instanceof VehicleModel && $target instanceof VehicleModel => $this->models($source, $target),
            $source instanceof Generation && $target instanceof Generation => $this->generations($source, $target),
            $source instanceof Brand && $target instanceof Brand => $this->brands($source, $target),
            default => throw new CatalogRefused('merge_level'),
        };

        $level = self::level($source);
        $sourceId = (int) $source->getKey();

        DB::afterCommit(function () use ($level, $sourceId): void {
            $level === CatalogLevel::Brand
                ? RelinkBrandModifications::dispatch($sourceId)
                : RelinkCatalogVehicles::dispatch(RelinkCatalogVehicles::entry($level, $sourceId));
        });

        return $this->counts;
    }

    public static function level(Make|VehicleModel|Generation|Brand $row): CatalogLevel
    {
        return match (true) {
            $row instanceof Make => CatalogLevel::Make,
            $row instanceof VehicleModel => CatalogLevel::Model,
            $row instanceof Generation => CatalogLevel::Generation,
            default => CatalogLevel::Brand,
        };
    }

    /**
     * @return class-string<Make|VehicleModel|Generation|Brand>
     */
    public static function modelClass(CatalogLevel $level): string
    {
        return match ($level) {
            CatalogLevel::Make => Make::class,
            CatalogLevel::Model => VehicleModel::class,
            CatalogLevel::Generation => Generation::class,
            CatalogLevel::Brand => Brand::class,
        };
    }

    private function makes(Make $source, Make $target): void
    {
        foreach (VehicleModel::query()->where('make_id', $source->getKey())->whereNull('merged_into_id')->orderBy('id')->lockForUpdate()->get() as $model) {
            $taken = VehicleModel::query()->where('make_id', $target->getKey())->where('slug', $model->getAttribute('slug'))->lockForUpdate()->first();

            if ($taken === null) {
                $model->forceFill(['make_id' => $target->getKey()])->save();
                $this->counts['models_moved']++;

                continue;
            }

            $this->models($model, CatalogSlugs::survivor($taken));
            $this->counts['models_merged']++;
        }

        $this->retire($source, $target);
    }

    private function models(VehicleModel $source, VehicleModel $target): void
    {
        foreach (Generation::query()->where('model_id', $source->getKey())->whereNull('merged_into_id')->orderBy('id')->lockForUpdate()->get() as $generation) {
            $taken = Generation::query()->where('model_id', $target->getKey())->where('slug', $generation->getAttribute('slug'))->lockForUpdate()->first();

            if ($taken === null) {
                $generation->forceFill(['model_id' => $target->getKey()])->save();
                $this->counts['generations_moved']++;

                continue;
            }

            $this->generations($generation, CatalogSlugs::survivor($taken));
            $this->counts['generations_merged']++;
        }

        $this->retire($source, $target);
    }

    private function generations(Generation $source, Generation $target): void
    {
        $this->retire($source, $target);
    }

    private function brands(Brand $source, Brand $target): void
    {
        /** @var list<string> $aliases */
        $aliases = array_values(array_filter([
            ...(is_array($target->aliases) ? $target->aliases : []),
            (string) $source->getAttribute('name'),
            ...(is_array($source->aliases) ? $source->aliases : []),
        ], is_string(...)));
        $name = mb_strtolower((string) $target->getAttribute('name'));
        $unique = [];

        foreach ($aliases as $alias) {
            $alias = trim($alias);

            if ($alias !== '' && mb_strtolower($alias) !== $name && ! in_array(mb_strtolower($alias), array_map(mb_strtolower(...), $unique), true)) {
                $unique[] = $alias;
            }
        }

        $target->forceFill(['aliases' => $unique === [] ? null : $unique])->save();
        Brand::query()->where('merged_into_id', $source->getKey())->update(['merged_into_id' => $target->getKey(), 'updated_at' => now()]);
        $source->forceFill(['merged_into_id' => $target->getKey()])->save();
    }

    private function retire(Make|VehicleModel|Generation $source, Make|VehicleModel|Generation $target): void
    {
        $source->newQuery()->where('merged_into_id', $source->getKey())->update(['merged_into_id' => $target->getKey(), 'updated_at' => now()]);
        $source->forceFill(['merged_into_id' => $target->getKey(), 'active' => false])->save();
    }
}
