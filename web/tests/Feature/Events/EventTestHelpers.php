<?php

use App\Enums\EventLocationVisibility;
use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\FeatureFlag;
use App\Models\User;

require_once __DIR__.'/../Social/SocialTestHelpers.php';

/**
 * M4.12 events test helpers, prefixed ev… so they never collide with another file's functions.
 */
function evFlags(array $flags = []): void
{
    foreach ([...['events' => true, 'events.create' => true, 'editorial_samples' => true], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }

    // FeatureFlags remembers answers per request; a test changing flags between calls starts over.
    request()->attributes->remove('speedclub.flags');
}

/** A member old enough to organise (09 §8.7: 14 days). */
function evOrganiser(array $attributes = []): User
{
    return User::factory()->create(['created_at' => now()->subDays(30), ...$attributes]);
}

function evEvent(?User $organiser = null, array $attributes = []): Event
{
    return Event::factory()->create(['organiser_id' => ($organiser ?? evOrganiser())->id, ...$attributes]);
}

function evPrivateEvent(?User $organiser = null, array $attributes = []): Event
{
    return evEvent($organiser, ['location_visibility' => EventLocationVisibility::AfterRsvp, ...$attributes]);
}

function evRsvp(Event $event, User $member, RsvpStatus $status = RsvpStatus::Going, array $attributes = []): EventRsvp
{
    return EventRsvp::factory()->create(['event_id' => $event->id, 'user_id' => $member->id, 'status' => $status, 'status_at' => now(), ...$attributes]);
}

/** A valid create body: a public meet next week in Hamburg. */
function evBody(array $overrides = []): array
{
    return [
        'title' => 'Abendtreffen am Hafen',
        'type' => 'meet',
        'starts_at' => now()->addDays(10)->setTime(18, 0)->toIso8601String(),
        'ends_at' => now()->addDays(10)->setTime(21, 0)->toIso8601String(),
        'venue_name' => 'Parkplatz Kai 3',
        'street' => 'Am Sandtorkai 3',
        'postcode' => '20457',
        'city' => 'Hamburg',
        'lat' => 53.54321,
        'lng' => 9.98765,
        'description' => 'Ruhiges Treffen, Motor aus.',
        'rules' => ['legal_only', 'no_racing'],
        'accept_rules' => true,
        ...$overrides,
    ];
}

/** Every string anywhere in a decoded JSON body, for "never the exact place" checks. */
function evStrings(mixed $value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION) ?: '';
}
