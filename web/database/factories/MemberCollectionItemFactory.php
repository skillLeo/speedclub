<?php

namespace Database\Factories;

use App\Enums\CollectionItemType;
use App\Models\MemberCollection;
use App\Models\MemberCollectionItem;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MemberCollectionItem>
 */
class MemberCollectionItemFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'collection_id' => MemberCollection::factory(),
            'item_type' => CollectionItemType::Vehicle,
            'item_id' => Vehicle::factory()->published(),
            'position' => 1,
            'created_at' => now(),
        ];
    }
}
