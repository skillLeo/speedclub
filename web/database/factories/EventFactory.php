<?php

namespace Database\Factories;

use App\Enums\EventLocationVisibility;
use App\Enums\EventRule;
use App\Enums\EventStatus;
use App\Enums\EventType;
use App\Enums\EventVisibility;
use App\Models\Event;
use App\Models\User;
use App\Services\Events\EventLocation;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A published public meet next week in Hamburg; states for the other statuses and an after_rsvp place.
 *
 * @extends Factory<Event>
 */
class EventFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $title = 'Treffen '.Str::title($this->faker->unique()->word());
        $starts = now()->addDays(7)->setTime(18, 0);
        $lat = 53.5413;
        $lng = 9.9845;
        [$areaLat, $areaLng] = EventLocation::area($lat, $lng);

        return [
            'organiser_id' => User::factory()->state(['created_at' => now()->subMonths(3)]),
            'slug' => Str::slug($title).'-'.Str::lower(Str::random(6)),
            'title' => $title,
            'type' => EventType::Meet,
            'status' => EventStatus::Published,
            'visibility' => EventVisibility::Public,
            'location_visibility' => EventLocationVisibility::Public,
            'starts_at' => $starts,
            'ends_at' => $starts->copy()->addHours(3),
            'timezone' => 'Europe/Berlin',
            'venue_name' => 'Parkplatz am Hafen',
            'street' => 'Am Sandtorkai 1',
            'postcode' => '20457',
            'city' => 'Hamburg',
            'country' => 'DE',
            'lat' => $lat,
            'lng' => $lng,
            'area_lat' => $areaLat,
            'area_lng' => $areaLng,
            'description' => 'Ruhiges Abendtreffen, Motor aus auf dem Platz.',
            'organiser_rules' => null,
            'rules' => [EventRule::LegalOnly->value, EventRule::NoRacing->value],
            'rules_accepted_at' => now(),
            'capacity' => null,
            'submitted_at' => now()->subDay(),
            'published_at' => now()->subDay(),
            'is_sample' => false,
        ];
    }

    public function pending(): static
    {
        return $this->state(['status' => EventStatus::PendingReview, 'published_at' => null]);
    }

    public function draft(): static
    {
        return $this->state(['status' => EventStatus::Draft, 'submitted_at' => null, 'published_at' => null]);
    }

    public function privateLocation(): static
    {
        return $this->state(['location_visibility' => EventLocationVisibility::AfterRsvp]);
    }

    public function cancelled(string $reason = 'Wetter'): static
    {
        return $this->state(['status' => EventStatus::Cancelled, 'cancelled_at' => now(), 'cancellation_reason' => $reason]);
    }
}
