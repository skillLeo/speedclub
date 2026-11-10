<?php

namespace Database\Seeders;

use App\Models\DiscoverCollection;
use App\Models\Vehicle;
use App\Services\Discover\SearchFilterResolver;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * DISC-01 Kollektionen (M2.3) from database/data/collections.json. Adds what is missing and leaves existing rows alone, so running it
 * again never undoes an admin's edits (ADM-29). Every filter set must resolve against the catalogue. `demo_cover` names a DemoSeeder
 * vehicle key: when that build exists (local, staging demo), it becomes the cover of a collection that has none; elsewhere the cover
 * falls back to the collection's build changed last.
 */
class CollectionSeeder extends Seeder
{
    use SeedsFromData;

    public function run(SearchFilterResolver $resolver): void
    {
        /** @var list<array{key: string, title: array<string, string>, subtitle?: array<string, string>, filters: array<string, mixed>, sort?: string, demo_cover?: string}> $rows */
        $rows = $this->readJson('collections.json');

        foreach ($rows as $position => $data) {
            if ($resolver->resolve($data['filters'])['errors'] !== []) {
                throw new RuntimeException("Collection [{$data['key']}] has filters the catalogue does not know.");
            }

            $collection = DiscoverCollection::query()->firstOrCreate(['key' => $data['key']], [
                'title' => $data['title'],
                'subtitle' => $data['subtitle'] ?? null,
                'filters' => $data['filters'],
                'sort' => $data['sort'] ?? null,
                'position' => ($position + 1) * 10,
                'active' => true,
            ]);

            $cover = isset($data['demo_cover'])
                ? Vehicle::query()->where('public_id', DemoSeeder::publicIdFor($data['demo_cover']))->value('id')
                : null;

            if ($cover !== null && $collection->getAttribute('cover_vehicle_id') === null) {
                $collection->update(['cover_vehicle_id' => $cover]);
            }
        }
    }
}
