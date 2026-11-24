<?php

namespace Database\Factories;

use App\Enums\CrewRole;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A plain member of a crew. Does not touch crews.members_count: tests that need it use the crew Actions or recount.
 *
 * @extends Factory<CrewMember>
 */
class CrewMemberFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'crew_id' => Crew::factory(),
            'user_id' => User::factory(),
            'role' => CrewRole::Member,
            'role_rank' => CrewRole::Member->rank(),
            'joined_at' => now(),
        ];
    }

    public function role(CrewRole $role): static
    {
        return $this->state(['role' => $role, 'role_rank' => $role->rank()]);
    }
}
