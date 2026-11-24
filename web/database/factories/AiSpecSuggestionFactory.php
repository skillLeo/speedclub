<?php

namespace Database\Factories;

use App\Models\AiSpecSuggestion;
use App\Models\Generation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiSpecSuggestion>
 */
class AiSpecSuggestionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'generation_id' => Generation::factory(),
            'model_id' => null,
            'model_year' => null,
            'cache_key' => hash('sha256', fake()->unique()->uuid()),
            'payload' => [['key' => '330ci', 'label' => '330Ci (M54B30)', 'fields' => ['engine_code' => 'M54B30', 'displacement_cc' => 2979, 'fuel' => 'petrol', 'power_value' => 231, 'power_unit' => 'ps', 'torque_nm' => 300]]],
            'ai_call_id' => null,
            'created_at' => now(),
            'expires_at' => now()->addDays(180),
        ];
    }
}
