<?php

namespace Database\Factories;

use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\ViewDay;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ViewDay>
 */
class ViewDayFactory extends Factory
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
            'source' => ViewSource::App,
            'views' => 1,
        ];
    }

    /**
     * Views of $vehicle's page (its owner as the owner).
     */
    public function forVehicle(Vehicle $vehicle): static
    {
        return $this->state(fn (): array => [
            'subject_type' => ViewSubject::Vehicle,
            'subject_id' => $vehicle->id,
            'owner_id' => $vehicle->owner_id,
            'vehicle_id' => $vehicle->id,
        ]);
    }

    /**
     * Views of $member's profile.
     */
    public function forProfile(User $member): static
    {
        return $this->state(fn (): array => [
            'subject_type' => ViewSubject::Profile,
            'subject_id' => $member->id,
            'owner_id' => $member->id,
            'vehicle_id' => null,
        ]);
    }
}
