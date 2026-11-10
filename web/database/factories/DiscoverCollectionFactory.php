<?php

namespace Database\Factories;

use App\Models\DiscoverCollection;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DiscoverCollection>
 */
class DiscoverCollectionFactory extends Factory
{
    protected $model = DiscoverCollection::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $word = fake()->unique()->word();

        return [
            'key' => 'kollektion-'.$word,
            'title' => ['de' => 'Kollektion '.ucfirst($word), 'en' => 'Collection '.ucfirst($word)],
            'subtitle' => null,
            'cover_vehicle_id' => null,
            'filters' => [],
            'sort' => null,
            'position' => 0,
            'active' => true,
        ];
    }
}
