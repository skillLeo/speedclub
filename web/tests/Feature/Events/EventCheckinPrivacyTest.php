<?php

use App\Enums\EventVisibility;
use App\Enums\GalleryPhotoStatus;
use App\Models\EventCheckin;
use App\Models\User;
use App\Services\DataExport\ExportContents;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';

/**
 * M5.6 check-in privacy (10 §16, m5.6-contract §5.1, §5.4): no location, device or IP column; the public "War dabei" shows only ended
 * events the member left visible, only events the reader may see, the date without the time, never across a block or for a member who
 * is not findable.
 */
beforeEach(function () {
    m56Flags();
    $this->member = User::factory()->create(['username' => 'mia.k']);
    $this->organiser = evOrganiser();
});

it('stores who and when only, never a place, a device or an address', function () {
    expect(Schema::getColumnListing('event_checkins'))->toEqualCanonicalizing([
        'id', 'event_id', 'user_id', 'checked_in_at', 'profile_visible', 'method', 'created_at', 'updated_at',
    ]);

    foreach (['event_checkins', 'event_checkin_codes'] as $table) {
        foreach (Schema::getColumnListing($table) as $column) {
            expect($column)->not->toMatch('/lat|lng|lon|geo|location|place|city|ip|device|agent/');
        }
    }
});

it('lists only ended events the member shows, newest first, with the Berlin date only', function () {
    // 00:10 in Berlin is still the day before in UTC: the date must be Berlin's.
    $this->travelTo(CarbonImmutable::parse('2026-11-15 00:30', 'Europe/Berlin'));
    $ended = evEvent($this->organiser, ['starts_at' => now()->subHours(3), 'ends_at' => now()->subMinutes(10)]);
    $older = evEvent($this->organiser, ['starts_at' => now()->subWeeks(2), 'ends_at' => now()->subWeeks(2)->addHours(3)]);
    $running = evEvent($this->organiser, ['starts_at' => now()->subHour(), 'ends_at' => now()->addHour()]);
    $hidden = evEvent($this->organiser, ['starts_at' => now()->subDays(3), 'ends_at' => now()->subDays(3)->addHours(2)]);
    m56Checkin($ended, $this->member, ['checked_in_at' => now()->subMinutes(20)]);
    m56Checkin($older, $this->member, ['checked_in_at' => now()->subWeeks(2)]);
    m56Checkin($running, $this->member, ['checked_in_at' => now()]);
    m56Checkin($hidden, $this->member, ['checked_in_at' => now()->subDays(3), 'profile_visible' => false]);

    $response = $this->getJson('/api/v1/public/users/mia.k/checkins')->assertOk();

    expect(array_column($response->json('data'), 'slug'))->toBe([$ended->slug, $older->slug])
        ->and($response->json('data.0.checked_in_on'))->toBe('2026-11-15')
        ->and($response->json('data.0'))->not->toHaveKey('my_rsvp')
        ->and($response->json('data.0'))->not->toHaveKey('checked_in_at');
});

it('shows only events the reader may see in a list', function () {
    $followers = evEvent($this->organiser, ['visibility' => EventVisibility::Followers, 'starts_at' => now()->subDays(2), 'ends_at' => now()->subDays(2)->addHours(2)]);
    $removed = evEvent($this->organiser, ['removed_at' => now(), 'starts_at' => now()->subDays(2), 'ends_at' => now()->subDays(2)->addHours(2)]);
    m56Checkin($followers, $this->member);
    m56Checkin($removed, $this->member);

    $this->getJson('/api/v1/public/users/mia.k/checkins')->assertOk()->assertJsonCount(0, 'data');

    $follower = User::factory()->create();
    socFollow($follower, $this->organiser);
    Sanctum::actingAs($follower);
    $this->getJson('/api/v1/public/users/mia.k/checkins')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.slug', $followers->slug);
});

it('hides the list across a block and for a member who is not findable', function () {
    $ended = evEvent($this->organiser, ['starts_at' => now()->subDays(2), 'ends_at' => now()->subDays(2)->addHours(2)]);
    m56Checkin($ended, $this->member);
    $blocked = User::factory()->create();
    socBlock($this->member, $blocked);

    Sanctum::actingAs($blocked);
    $this->getJson('/api/v1/public/users/mia.k/checkins')->assertNotFound()->assertJsonPath('code', 'member_unavailable');

    $this->member->forceFill(['discoverable' => false])->save();
    Sanctum::actingAs(User::factory()->create());
    $this->getJson('/api/v1/public/users/mia.k/checkins')->assertOk()->assertJsonCount(0, 'data');

    Sanctum::actingAs($this->member);
    $this->getJson('/api/v1/public/users/mia.k/checkins')->assertOk()->assertJsonCount(1, 'data');
});

it('leaves out events of an organiser the reader blocked', function () {
    $ended = evEvent($this->organiser, ['starts_at' => now()->subDays(2), 'ends_at' => now()->subDays(2)->addHours(2)]);
    m56Checkin($ended, $this->member);
    $reader = User::factory()->create();
    socBlock($reader, $this->organiser);
    Sanctum::actingAs($reader);

    $this->getJson('/api/v1/public/users/mia.k/checkins')->assertOk()->assertJsonCount(0, 'data');
});

it('validates the page size (at most 20) and sends an ETag', function () {
    $this->getJson('/api/v1/public/users/mia.k/checkins?per_page=21')->assertUnprocessable()->assertJsonValidationErrors('per_page');
    expect($this->getJson('/api/v1/public/users/mia.k/checkins')->assertOk()->headers->get('ETag'))->not->toBeNull();
});

it('deletes the check-ins with the account and with the event', function () {
    $ended = evEvent($this->organiser, ['starts_at' => now()->subDays(2), 'ends_at' => now()->subDays(2)->addHours(2)]);
    $other = evEvent($this->organiser, ['starts_at' => now()->subDays(3), 'ends_at' => now()->subDays(3)->addHours(2)]);
    m56Checkin($ended, $this->member);
    m56Checkin($other, User::factory()->create());

    $this->member->forceDelete();
    expect(EventCheckin::query()->where('event_id', $ended->id)->count())->toBe(0);

    $other->delete();
    expect(EventCheckin::query()->count())->toBe(0);
});

// Review SF-6 (Art. 15/20): the export carries the member's own check-ins and gallery uploads with the event's title and link only.
it('exports the member\'s own check-ins and gallery photos, nobody else\'s', function () {
    $event = m56JustEnded($this->organiser, ['title' => 'Cars am Hafen']);
    $other = User::factory()->create(['username' => 'fremd.2']);
    m56Checkin($event, $this->member, ['profile_visible' => false]);
    m56Checkin($event, $other);
    m56GalleryPhoto($event, $this->member, GalleryPhotoStatus::Rejected, ['reject_reason' => 'Unscharf']);
    m56GalleryPhoto($event, $other);

    $events = app(ExportContents::class)->documents($this->member)['events.json'];

    expect($events['checkins'])->toHaveCount(1)
        ->and($events['checkins'][0])->toMatchArray(['event' => 'Cars am Hafen', 'url' => '/e/'.$event->slug, 'shown_on_profile' => false])
        ->and($events['gallery_photos'])->toHaveCount(1)
        ->and($events['gallery_photos'][0])->toMatchArray(['event' => 'Cars am Hafen', 'status' => 'rejected', 'reject_reason' => 'Unscharf'])
        ->and(evStrings($events))->not->toContain('fremd.2');
});
