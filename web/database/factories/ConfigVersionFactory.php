<?php

namespace Database\Factories;

use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ConfigVersion>
 */
class ConfigVersionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => 'branding',
            'version' => fake()->unique()->numberBetween(1, 1000000),
            'status' => ConfigVersionStatus::Draft,
            'payload' => ['accent_set' => 'default'],
        ];
    }
}
