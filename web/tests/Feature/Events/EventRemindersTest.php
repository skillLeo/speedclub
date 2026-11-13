<?php

use App\Actions\Account\DeleteAccount;
use App\Enums\EventStatus;
use App\Enums\NotificationType;
use App\Enums\RsvpStatus;
use App\Mail\EventReminderMail;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Notifications\NotificationFeed;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\SendPushNotification;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EventTestHelpers.php';

/**
 * M4.12 scheduled work (09 §8.7, §13): reminders 24 h and 2 h before for going members (time travel, idempotent), the daily
 * housekeeping (retention, waitlists) and what closing an account does to events.
 */
beforeEach(function () {
    evFlags();
    Mail::fake();
    $this->organiser = evOrganiser();
    $this->event = evEvent($this->organiser, ['starts_at' => now()->addDays(3)->setTime(18, 0), 'ends_at' => now()->addDays(3)->setTime(21, 0)]);
    $this->going = User::factory()->create(['locale' => 'de']);
    $this->interested = User::factory()->create();
    evRsvp($this->event, $this->going);
    evRsvp($this->event, $this->interested, RsvpStatus::Interested);
});

it('reminds going members 24 h and 2 h before, once each, with a push and the mail they chose', function () {
    config(['speedclub.push.enabled' => true]);
    Queue::fake();
    PushToken::factory()->create(['user_id' => $this->going->id, 'platform' => 'android']);
    $this->going->forceFill(['notification_prefs' => ['types' => ['event_reminder' => ['email' => true]], 'quiet_hours' => ['enabled' => false]]])->save();

    $this->artisan('events:reminders')->assertSuccessful();
    expect(Notification::query()->where('type', NotificationType::EventReminder)->count())->toBe(0);

    $this->travelTo($this->event->starts_at->subHours(23));
    $this->artisan('events:reminders')->assertSuccessful()->expectsOutput('Reminded 1 members.');
    $this->artisan('events:reminders')->assertSuccessful()->expectsOutput('Reminded 0 members.');

    $this->travelTo($this->event->starts_at->subMinutes(90));
    $this->artisan('events:reminders')->assertSuccessful();
    $this->artisan('events:reminders')->assertSuccessful();

    $rows = Notification::query()->where('type', NotificationType::EventReminder)->get();
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('notifiable_id')->unique()->all())->toBe([$this->going->id])
        ->and($rows->pluck('data.kind')->sort()->values()->all())->toBe(['24h', '2h'])
        ->and($this->event->fresh()?->getAttribute('reminded_2h_at'))->not->toBeNull();
    Queue::assertPushed(SendPushNotification::class, 2);
    Mail::assertSent(EventReminderMail::class, 2);

    $row = app(NotificationFeed::class)->find($this->going, (string) $rows->firstWhere('data.kind', '2h')?->id);
    expect(app(NotificationTexts::class)->push($row, $this->going)['body'] ?? '')->toContain($this->event->title)
        ->and(app(NotificationTexts::class)->path($row))->toBe('/events/'.$this->event->slug);

    Sanctum::actingAs($this->going);
    $this->getJson('/api/v1/notifications')->assertOk()
        ->assertJsonPath('data.0.type', 'event_reminder')
        ->assertJsonPath('data.0.details.kind', '2h')
        ->assertJsonPath('data.0.event.slug', $this->event->slug);
});

it('reminds again after the start moved, skips the 24 h reminder inside two hours, and nothing while the flag is off', function () {
    $this->travelTo($this->event->starts_at->subHours(20));
    $this->artisan('events:reminders');
    Sanctum::actingAs($this->organiser);
    $this->patchJson("/api/v1/events/{$this->event->slug}", ['starts_at' => now()->addDays(2)->toIso8601String(), 'ends_at' => now()->addDays(2)->addHours(3)->toIso8601String()])->assertOk();

    $this->travelTo(now()->addDays(2)->subHours(10));
    $this->artisan('events:reminders');
    expect(Notification::query()->where('type', NotificationType::EventReminder)->count())->toBe(2);

    $late = evEvent(null, ['starts_at' => now()->addMinutes(100), 'ends_at' => now()->addHours(4)]);
    evRsvp($late, $this->going);
    $this->artisan('events:reminders');
    expect(Notification::query()->where('type', NotificationType::EventReminder)->where('data->event_id', $late->id)->pluck('data')->pluck('kind')->all())->toBe(['2h']);

    evFlags(['events' => false]);
    $this->artisan('events:reminders')->expectsOutput('Events are switched off.');
});

it('tells nothing to a member who blocked the organiser', function () {
    socBlock($this->going, $this->organiser);
    $this->travelTo($this->event->starts_at->subHours(23));

    $this->artisan('events:reminders')->expectsOutput('Reminded 0 members.');
});

it('cleans up after the retention periods and fills waitlists', function () {
    $old = evEvent(null, ['status' => EventStatus::Cancelled]);
    $old->forceFill(['updated_at' => now()->subMonths(13)])->saveQuietly();
    $recent = evEvent(null, ['status' => EventStatus::Cancelled]);
    $ancient = evEvent(null, ['starts_at' => now()->subMonths(25), 'ends_at' => now()->subMonths(25)->addHours(2)]);
    $full = evEvent(null, ['capacity' => 1]);
    $waiting = User::factory()->create();
    evRsvp($full, $waiting, RsvpStatus::Waitlist);

    $this->artisan('events:housekeeping')->assertSuccessful();

    expect(Event::query()->whereKey([$old->id, $ancient->id])->count())->toBe(0)
        ->and(Event::query()->find($recent->id))->not->toBeNull()
        ->and(EventRsvp::query()->where('user_id', $waiting->id)->value('status'))->toBe(RsvpStatus::Going);
});

it('withdraws the answers and cancels the upcoming events of a member who closes the account', function () {
    $full = evEvent(null, ['capacity' => 1]);
    evRsvp($full, $this->organiser);
    $waiting = User::factory()->create();
    evRsvp($full, $waiting, RsvpStatus::Waitlist);

    app(DeleteAccount::class)->handle($this->organiser);

    expect($this->event->fresh()?->status)->toBe(EventStatus::Cancelled)
        ->and(EventRsvp::query()->where('user_id', $this->organiser->id)->count())->toBe(0)
        ->and(EventRsvp::query()->where('user_id', $waiting->id)->value('status'))->toBe(RsvpStatus::Going)
        ->and(Notification::query()->where('notifiable_id', $this->going->id)->where('type', NotificationType::EventCancelled)->count())->toBe(1);

    $this->getJson("/api/v1/events/{$this->event->slug}")->assertNotFound();
});
