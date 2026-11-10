<?php

namespace Database\Factories;

use App\Models\MembershipPlan;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MembershipPlan>
 */
class MembershipPlanFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => 'plan-'.fake()->unique()->numberBetween(1, 99999),
            'name' => ['de' => 'Club Plus', 'en' => 'Club Plus'],
            'features' => ['de' => ['Mehr Fotos pro Fahrzeug'], 'en' => ['More photos per vehicle']],
            'active' => true,
            'sort' => 0,
        ];
    }
}
