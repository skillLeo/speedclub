<?php

namespace Database\Factories;

use App\Models\AiTextNormalisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiTextNormalisation>
 */
class AiTextNormalisationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'feature' => 'product_match',
            'cache_key' => hash('sha256', fake()->unique()->uuid()),
            'payload' => ['brand' => 'KW', 'terms' => ['Variant', '3']],
            'created_at' => now(),
            'expires_at' => now()->addDays(30),
        ];
    }
}
