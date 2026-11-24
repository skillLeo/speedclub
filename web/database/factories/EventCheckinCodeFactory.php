<?php

namespace Database\Factories;

use App\Models\Event;
use App\Models\EventCheckinCode;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EventCheckinCode>
 */
class EventCheckinCodeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'event_id' => Event::factory(),
            'code' => 'ABC234',
            'expires_at' => now()->addSeconds(300),
            'created_at' => now(),
        ];
    }
}
