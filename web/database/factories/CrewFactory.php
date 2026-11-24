<?php

namespace Database\Factories;

use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\User;
use App\Services\Crews\CrewNames;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * An active open crew without members; foundedBy() adds the founder (a new member unless one is named).
 *
 * @extends Factory<Crew>
 */
class CrewFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $words = $this->faker->unique()->words(2, true);
        $name = 'Crew '.Str::title(is_string($words) ? $words : implode(' ', $words));
        $name = mb_substr($name, 0, 40);

        return [
            'name' => $name,
            'name_key' => CrewNames::key($name),
            'slug' => Str::slug($name).'-'.Str::lower(Str::random(4)),
            'description' => 'Wir treffen uns jeden zweiten Samstag und schrauben zusammen.',
            'bundesland' => null,
            'join_mode' => CrewJoinMode::Open,
            'status' => CrewStatus::Active,
            'members_count' => 0,
            'is_sample' => false,
        ];
    }

    /**
     * Adds the founder's membership ($founder, else a new member) once the crew exists.
     */
    public function foundedBy(?User $founder = null): static
    {
        return $this->afterCreating(function (Crew $crew) use ($founder): void {
            $founder ??= User::factory()->create();
            CrewMember::factory()->role(CrewRole::Founder)->create(['crew_id' => $crew->id, 'user_id' => $founder->id]);
            $crew->forceFill(['members_count' => CrewMember::query()->where('crew_id', $crew->id)->count()])->saveQuietly();
        });
    }

    public function joinMode(CrewJoinMode $mode): static
    {
        return $this->state(['join_mode' => $mode]);
    }
}
