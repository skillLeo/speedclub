<?php

namespace Database\Factories;

use App\Enums\CheckinMethod;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EventCheckin>
 */
class EventCheckinFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'event_id' => Event::factory(),
            'user_id' => User::factory(),
            'checked_in_at' => now(),
            'profile_visible' => true,
            'method' => CheckinMethod::Code,
        ];
    }
}
