<?php

namespace Database\Factories;

use App\Models\ModCategory;
use App\Models\ModCategorySchemaVersion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ModCategorySchemaVersion>
 */
class ModCategorySchemaVersionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'category_id' => ModCategory::factory(),
            'version' => 1,
            'schema' => [],
            'created_at' => now(),
        ];
    }
}
