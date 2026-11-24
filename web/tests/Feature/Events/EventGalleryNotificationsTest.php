<?php

use App\Enums\GalleryPhotoStatus;
use App\Enums\NotificationType;
use App\Models\Notification;
use App\Models\User;
use Carbon\CarbonImmutable;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';
require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M5.6 gallery notifications (m5.6-contract §4.6): the organiser hears about waiting photos (one row per event and day, the push at most
 * once a day, the event_update switch); the uploader about the decision, in the app only; nobody else.
 */
beforeEach(function () {
    m56Flags();
    m56Disks();
    $this->travelTo(CarbonImmutable::parse('2026-11-16 14:00', 'Europe/Berlin'));
    $this->organiser = evOrganiser();
    $this->event = m56JustEnded($this->organiser, ['title' => 'Cars & Coffee am Hafen']);
    $this->attendee = User::factory()->create();
    evRsvp($this->event, $this->attendee);
});

it('tells the organiser once per event and day, grouped with the number waiting', function () {
    ntfPushOn($this->organiser);
    $other = User::factory()->create();
    evRsvp($this->event, $other);

    Sanctum::actingAs($this->attendee);
    $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();
    $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();
    Sanctum::actingAs($other);
    $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();

    $row = Notification::query()->where('notifiable_id', $this->organiser->id)->sole();
    expect($row->type)->toBe(NotificationType::EventGalleryPending)
        ->and($row->data['count'])->toBe(3)
        ->and(ntfPushes())->toHaveCount(1)
        ->and(evStrings(ntfPushes()[0]))->toContain('Cars & Coffee am Hafen')->toContain('/manage#gallery');

    Sanctum::actingAs($this->organiser);
    $this->getJson('/api/v1/notifications')->assertJsonPath('data.0.type', 'event_gallery_pending')->assertJsonPath('data.0.details.count', 3)
        ->assertJsonPath('data.0.event.slug', $this->event->slug);

    // The next day: a new row, which may push again.
    $this->travel(1)->days();
    Sanctum::actingAs($this->attendee);
    $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();
    expect(Notification::query()->where('notifiable_id', $this->organiser->id)->count())->toBe(2)->and(ntfPushes())->toHaveCount(2);
});

it('does not push when the organiser switched event updates off, and never for the organiser\'s own photos', function () {
    $this->organiser->forceFill(['notification_prefs' => ['types' => ['event_update' => ['push' => false]]]])->save();
    ntfPushOn($this->organiser);

    Sanctum::actingAs($this->organiser);
    $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();
    expect(Notification::query()->count())->toBe(0);

    Sanctum::actingAs($this->attendee);
    $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();
    expect(Notification::query()->where('notifiable_id', $this->organiser->id)->count())->toBe(1)->and(ntfPushes())->toHaveCount(0);
});

it('tells the uploader about the decision in the app only, and no other attendee', function () {
    ntfPushOn($this->attendee);
    $bystander = User::factory()->create();
    evRsvp($this->event, $bystander);
    $approved = m56GalleryPhoto($this->event, $this->attendee, GalleryPhotoStatus::Pending);
    $rejected = m56GalleryPhoto($this->event, $this->attendee, GalleryPhotoStatus::Pending);
    Sanctum::actingAs($this->organiser);

    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$approved->id}/approve")->assertOk();
    $this->postJson("/api/v1/events/{$this->event->slug}/gallery/{$rejected->id}/reject", ['reason' => 'Unscharf'])->assertOk();

    $rows = Notification::query()->where('notifiable_id', $this->attendee->id)->orderBy('group_key')->get();
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('type')->unique()->all())->toBe([NotificationType::EventPhotoDecided])
        ->and($rows->pluck('pushed_at')->filter()->all())->toBe([])
        ->and(ntfPushes())->toHaveCount(0)
        ->and(Notification::query()->where('notifiable_id', $bystander->id)->count())->toBe(0)
        ->and(evStrings($rows->pluck('data')->all()))->not->toContain('Unscharf');

    Sanctum::actingAs($this->attendee);
    $outcomes = collect($this->getJson('/api/v1/notifications')->json('data'))->pluck('details.outcome')->sort()->values()->all();
    expect($outcomes)->toBe(['approved', 'rejected']);
});
