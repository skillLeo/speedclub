<?php

namespace Database\Factories;

use App\Enums\DexSetKind;
use App\Models\DexSet;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DexSet>
 */
class DexSetFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => 'set-'.fake()->unique()->lexify('??????'),
            'name_de' => 'Stadtkenner',
            'name_en' => 'City regular',
            'kind' => DexSetKind::City,
            'rule_json' => ['target' => 10],
            'starts_on' => null,
            'ends_on' => null,
            'hidden' => false,
            'sort' => 0,
        ];
    }
}
