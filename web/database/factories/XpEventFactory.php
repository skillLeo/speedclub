<?php

namespace Database\Factories;

use App\Enums\XpType;
use App\Models\User;
use App\Models\XpEvent;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<XpEvent>
 */
class XpEventFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'type' => XpType::BuildUpdate,
            'points' => 15,
            'capped' => false,
            'ref_type' => 'build_update',
            'ref_id' => strtolower((string) Str::ulid()),
            'day' => now(config()->string('speedclub.notifications.timezone'))->toDateString(),
            'created_at' => now(),
        ];
    }
}
