<?php

namespace Database\Seeders;

use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Support\Slug;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * The makes/models/generations catalogue of a fresh install. ADR-234: it only fills an **empty** catalogue. Once any make exists
 * (seeded, created in ADM-16, or merged and kept as an alias), it does nothing: adding "what is missing" would bring back an entry the
 * team deleted in the admin. New catalogue data on a live host goes through the ADM-17 import.
 */
class CatalogSeeder extends Seeder
{
    use SeedsFromData;

    public function run(): void
    {
        if (self::catalogueHasRows()) {
            $this->command?->warn('CatalogSeeder skipped: the catalogue already has entries (ADR-234).');

            return;
        }

        /** @var list<array{name: string, country: string, popular: bool, models: array<array-key, list<array{0: string, 1: int, 2: int|null}>>}> $makes */
        $makes = $this->readJson('catalog.json');

        DB::transaction(function () use ($makes): void {
            $now = now();

            foreach ($makes as $index => $data) {
                $make = Make::query()->firstOrCreate(['slug' => Slug::make($data['name'])], [
                    'name' => $data['name'],
                    'country' => $data['country'],
                    'is_popular' => $data['popular'],
                    'sort' => $index + 1,
                ]);
                $models = VehicleModel::query()->where('make_id', $make->id)->pluck('id', 'slug')->all();

                foreach ($data['models'] as $modelName => $generations) {
                    // JSON keys such as "911" come back from PHP as integers.
                    $modelName = (string) $modelName;
                    $slug = Slug::make($modelName);
                    $modelId = $models[$slug] ?? VehicleModel::query()->create(['make_id' => $make->id, 'slug' => $slug, 'name' => $modelName])->id;
                    $existing = Generation::query()->where('model_id', $modelId)->pluck('slug')->all();
                    $rows = [];

                    foreach ($generations as [$name, $from, $to]) {
                        if (! in_array(Slug::make($name), $existing, true)) {
                            $rows[] = ['model_id' => $modelId, 'slug' => Slug::make($name), 'name' => $name, 'year_from' => $from, 'year_to' => $to, 'created_at' => $now, 'updated_at' => $now];
                        }
                    }

                    Generation::query()->insert($rows);
                }
            }
        });
    }

    public static function catalogueHasRows(): bool
    {
        return Make::query()->exists() || VehicleModel::query()->exists() || Generation::query()->exists();
    }
}
