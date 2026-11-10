<?php

namespace Database\Factories;

use App\Models\Entitlement;
use App\Models\MembershipPlan;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Entitlement>
 */
class EntitlementFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'plan_id' => MembershipPlan::factory(),
            'reason' => 'Dankeschön für die Hilfe beim Beta-Test.',
            'starts_at' => now(),
            'ends_at' => null,
        ];
    }
}
