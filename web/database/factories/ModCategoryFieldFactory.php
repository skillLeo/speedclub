<?php

namespace Database\Factories;

use App\Enums\ModFieldType;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ModCategoryField>
 */
class ModCategoryFieldFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'category_id' => ModCategory::factory(),
            'key' => fake()->unique()->lexify('field_????????'),
            'label' => ['de' => 'Tieferlegung vorne', 'en' => 'Lowering front'],
            'type' => ModFieldType::Number,
            'unit' => 'mm',
            'min' => 0,
            'max' => 150,
            'step' => 1,
        ];
    }
}
