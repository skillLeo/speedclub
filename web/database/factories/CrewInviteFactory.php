<?php

namespace Database\Factories;

use App\Enums\CrewRole;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An open invitation, sent by the crew's founder.
 *
 * @extends Factory<CrewInvite>
 */
class CrewInviteFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'crew_id' => Crew::factory()->foundedBy(),
            'user_id' => User::factory(),
            'invited_by' => fn (array $attributes): ?string => CrewMember::query()->where('crew_id', $attributes['crew_id'])
                ->where('role', CrewRole::Founder->value)->value('user_id'),
        ];
    }
}
