<?php

namespace Database\Factories;

use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use App\Models\User;
use App\Models\ViewEvent;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ViewEvent>
 */
class ViewEventFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'subject_type' => ViewSubject::Profile,
            'owner_id' => User::factory(),
            // After owner_id, so the closure gets the created member's id (a profile view of the owner).
            'subject_id' => fn (array $attributes): string => (string) $attributes['owner_id'],
            'vehicle_id' => null,
            'day' => now('Europe/Berlin')->toDateString(),
            'source' => ViewSource::Web,
            'viewer_hash' => bin2hex(random_bytes(16)),
        ];
    }
}
