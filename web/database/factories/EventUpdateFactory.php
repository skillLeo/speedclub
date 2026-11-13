<?php

namespace Database\Factories;

use App\Models\Event;
use App\Models\EventUpdate;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EventUpdate>
 */
class EventUpdateFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'event_id' => Event::factory(),
            'author_id' => User::factory(),
            'body' => 'Einfahrt über Tor 2, bitte ruhig auf den Platz.',
        ];
    }
}
