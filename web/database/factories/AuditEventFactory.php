<?php

namespace Database\Factories;

use App\Enums\AuditActorType;
use App\Models\AuditEvent;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Rows with a random hash, for tests of reads. They do not form a valid chain.
 *
 * @extends Factory<AuditEvent>
 */
class AuditEventFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'occurred_at' => now(),
            'actor_type' => AuditActorType::System,
            'action' => 'member.login',
            'hash' => fake()->unique()->sha256(),
        ];
    }
}
