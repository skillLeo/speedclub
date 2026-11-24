<?php

namespace Database\Factories;

use App\Models\Crew;
use App\Models\CrewRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An open join request.
 *
 * @extends Factory<CrewRequest>
 */
class CrewRequestFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'crew_id' => Crew::factory()->foundedBy(),
            'user_id' => User::factory(),
        ];
    }
}
