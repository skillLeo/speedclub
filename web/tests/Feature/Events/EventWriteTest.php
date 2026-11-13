<?php

use App\Enums\EventStatus;
use App\Enums\NotificationType;
use App\Enums\RsvpStatus;
use App\Jobs\Events\NotifyEventChange;
use App\Models\Event;
use App\Models\Media;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EventTestHelpers.php';

/**
 * M4.12 organiser writes (09 §8.7, EVT-03, EVT-06): creation rights, pre-moderation, edit, send, cancel, delete, cover, updates.
 */
beforeEach(function () {
    evFlags();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
});

describe('POST events', function () {
    it('creates a draft with the rules accepted and the area point, and the exact place only for the organiser', function () {
        Sanctum::actingAs($this->organiser);

        $response = $this->postJson('/api/v1/events', evBody())->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.location.exact', true)
            ->assertJsonPath('data.location.street', 'Am Sandtorkai 3')
            ->assertJsonPath('data.review.submitted_at', null);

        $event = Event::query()->sole();
        expect($event->organiser_id)->toBe($this->organiser->id)
            ->and($event->getAttribute('rules_accepted_at'))->not->toBeNull()
            ->and($event->getAttribute('area_lat'))->toBe(53.525)
            ->and($event->slug)->toStartWith('abendtreffen-am-hafen-')
            ->and($response->json('data.slug'))->toBe($event->slug);
    });

    it('sends the first events of an organiser and every after_rsvp event to review, later ones straight out', function () {
        Sanctum::actingAs($this->organiser);

        $this->postJson('/api/v1/events', evBody(['submit' => true]))->assertCreated()->assertJsonPath('data.status', 'pending_review');
        evEvent($this->organiser, ['published_at' => now()->subWeek()]);
        evEvent($this->organiser, ['published_at' => now()->subWeek()]);
        $this->postJson('/api/v1/events', evBody(['submit' => true]))->assertCreated()->assertJsonPath('data.status', 'published');
        $this->postJson('/api/v1/events', evBody(['submit' => true, 'location_visibility' => 'after_rsvp']))->assertCreated()->assertJsonPath('data.status', 'pending_review');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status, ?string $code) {
        $viewer = $who($this->organiser);

        if ($viewer !== null) {
            $viewer->forceFill(['created_at' => now()->subDays(30)])->save();
        }

        socActAs($viewer);
        $response = $this->postJson('/api/v1/events', evBody())->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [201, null],
        'unverified member' => [403, 'email_not_verified'],
        'member restricted from publishing' => [403, 'account_restricted'],
        'member restricted from messaging' => [201, null],
        'suspended member' => [403, null],
        'deactivated member' => [403, null],
        'member who blocked the other' => [201, null],
        'member the other blocked' => [201, null],
    ]));

    it('needs an account at least 14 days old', function () {
        $new = User::factory()->create(['created_at' => now()->subDays(3)]);
        Sanctum::actingAs($new);

        $this->postJson('/api/v1/events', evBody())->assertForbidden()
            ->assertJsonPath('code', 'organiser_not_eligible')
            ->assertJsonPath('eligible_at', $new->created_at->addDays(14)->toIso8601String());
    });

    it('validates the body, the rules and the times', function () {
        Sanctum::actingAs($this->organiser);

        $this->postJson('/api/v1/events', evBody(['accept_rules' => false]))->assertUnprocessable()->assertJsonValidationErrors('accept_rules');
        $this->postJson('/api/v1/events', evBody(['type' => 'rennen']))->assertUnprocessable()->assertJsonValidationErrors('type');
        $this->postJson('/api/v1/events', evBody(['starts_at' => now()->subDay()->toIso8601String()]))->assertUnprocessable()->assertJsonValidationErrors('starts_at');
        $this->postJson('/api/v1/events', evBody(['ends_at' => now()->addDays(10)->setTime(17, 0)->toIso8601String()]))->assertUnprocessable()->assertJsonPath('errors.ends_at.0', __('events.ends_before_start'));
        $this->postJson('/api/v1/events', evBody(['lat' => 53.5, 'lng' => null]))->assertUnprocessable();
        $this->postJson('/api/v1/events', evBody(['rules' => ['legal_only', 'drift']]))->assertUnprocessable();
        $this->postJson('/api/v1/events', evBody(['submit' => true, 'rules' => ['no_litter']]))->assertUnprocessable()->assertJsonPath('errors.rules.0', __('events.legal_only_required'));
        expect(Event::query()->where('status', '!=', EventStatus::Draft->value)->count())->toBe(0);
    });

    it('answers a repeated Idempotency-Key with the first event', function () {
        Sanctum::actingAs($this->organiser);

        $first = $this->postJson('/api/v1/events', evBody(), ['Idempotency-Key' => 'ev-create-1'])->assertCreated();
        $this->postJson('/api/v1/events', evBody(), ['Idempotency-Key' => 'ev-create-1'])->assertCreated()->assertJsonPath('data.id', $first->json('data.id'));
        expect(Event::query()->count())->toBe(1);
    });

    it('is rate limited and bounded per organiser', function () {
        Sanctum::actingAs($this->organiser);
        socLimit('events');

        $this->postJson('/api/v1/events', evBody())->assertCreated();
        $this->postJson('/api/v1/events', evBody())->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });

    it('stops at 20 open events', function () {
        Event::factory()->count(20)->draft()->create(['organiser_id' => $this->organiser->id]);
        Sanctum::actingAs($this->organiser);

        $this->postJson('/api/v1/events', evBody())->assertStatus(409)->assertJsonPath('code', 'limit_reached');
    });

    it('answers 404 feature_disabled while events.create is off', function () {
        evFlags(['events.create' => false]);
        Sanctum::actingAs($this->organiser);

        $this->postJson('/api/v1/events', evBody())->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });
});

describe('PATCH, submit, cancel and DELETE', function () {
    it('lets only the organiser change an event, and tells attendees when time or place change', function () {
        // An organiser past pre-moderation: their published event stays published when edited (SEC-412-01 covers the others).
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        Queue::fake();
        $event = evEvent($this->organiser);
        evRsvp($event, User::factory()->create());

        Sanctum::actingAs(User::factory()->create());
        $this->patchJson("/api/v1/events/{$event->slug}", ['title' => 'Fremd'])->assertForbidden();

        Sanctum::actingAs($this->organiser);
        $this->patchJson("/api/v1/events/{$event->slug}", ['description' => 'Neue Beschreibung'])->assertOk();
        Queue::assertNothingPushed();
        $this->patchJson("/api/v1/events/{$event->slug}", ['city' => 'Bremen', 'lat' => 53.0793, 'lng' => 8.8017])->assertOk()->assertJsonPath('data.location.city', 'Bremen');
        Queue::assertPushed(NotifyEventChange::class, fn (NotifyEventChange $job): bool => $job->eventId === $event->id);
        $this->patchJson("/api/v1/events/{$event->slug}", ['location_visibility' => 'after_rsvp'])->assertUnprocessable()->assertJsonValidationErrors('location_visibility');
    });

    it('promotes the waitlist when the capacity grows', function () {
        $event = evEvent($this->organiser, ['capacity' => 1]);
        evRsvp($event, User::factory()->create());
        $waiting = User::factory()->create();
        evRsvp($event, $waiting, RsvpStatus::Waitlist);
        Sanctum::actingAs($this->organiser);

        $this->patchJson("/api/v1/events/{$event->slug}", ['capacity' => 2])->assertOk();
        expect($event->rsvps()->where('user_id', $waiting->id)->value('status'))->toBe(RsvpStatus::Going)
            ->and(Notification::query()->where('notifiable_id', $waiting->id)->where('type', NotificationType::EventPromoted)->count())->toBe(1);
    });

    it('sends a draft and refuses to send twice', function () {
        $draft = evEvent($this->organiser, ['status' => EventStatus::Draft, 'published_at' => null, 'submitted_at' => null]);
        Sanctum::actingAs($this->organiser);

        $this->postJson("/api/v1/events/{$draft->slug}/submit")->assertOk()->assertJsonPath('data.status', 'pending_review');
        $this->postJson("/api/v1/events/{$draft->slug}/submit")->assertStatus(409)->assertJsonPath('code', 'event_closed');
    });

    it('cancels with a reason and tells everybody with an answer', function () {
        $event = evEvent($this->organiser);
        $going = User::factory()->create();
        $interested = User::factory()->create();
        evRsvp($event, $going);
        evRsvp($event, $interested, RsvpStatus::Interested);
        Sanctum::actingAs($this->organiser);

        $this->postJson("/api/v1/events/{$event->slug}/cancel", ['reason' => 'Unwetterwarnung'])->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.cancellation_reason', 'Unwetterwarnung');
        expect(Notification::query()->where('type', NotificationType::EventCancelled)->pluck('notifiable_id')->sort()->values()->all())
            ->toBe(collect([$going->id, $interested->id])->sort()->values()->all());
        $this->postJson("/api/v1/events/{$event->slug}/cancel", ['reason' => 'Nochmal'])->assertStatus(409);

        Sanctum::actingAs($going);
        $this->getJson("/api/v1/events/{$event->slug}")->assertOk()->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.can.rsvp', false);
    });

    it('deletes drafts and past events, but asks to cancel an upcoming one with answers first', function () {
        $draft = evEvent($this->organiser, ['status' => EventStatus::Draft]);
        $live = evEvent($this->organiser);
        evRsvp($live, User::factory()->create());
        Sanctum::actingAs(User::factory()->create());
        $this->deleteJson("/api/v1/events/{$draft->slug}")->assertNotFound();

        Sanctum::actingAs($this->organiser);
        $this->deleteJson("/api/v1/events/{$draft->slug}")->assertNoContent();
        $this->deleteJson("/api/v1/events/{$live->slug}")->assertStatus(409)->assertJsonPath('code', 'conflict');
        expect(Event::query()->pluck('id')->all())->toBe([$live->id]);
    });

    it('lets a publishing-restricted organiser cancel and delete but not edit', function () {
        $event = evEvent($this->organiser);
        $this->organiser->forceFill(['restrictions' => ['publishing' => ['until' => null]]])->save();
        Sanctum::actingAs($this->organiser->fresh());

        $this->patchJson("/api/v1/events/{$event->slug}", ['title' => 'Neu'])->assertForbidden()->assertJsonPath('code', 'account_restricted');
        $this->postJson("/api/v1/events/{$event->slug}/cancel", ['reason' => 'Geht nicht'])->assertOk();
        $this->deleteJson("/api/v1/events/{$event->slug}")->assertNoContent();
    });
});

describe('POST events/{slug}/cover', function () {
    it('uploads a re-encoded cover that replaces the previous one', function () {
        Storage::fake('public');
        Storage::fake('local');
        config(['speedclub.media.disk' => 'public']);
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        $event = evEvent($this->organiser);
        Sanctum::actingAs($this->organiser);

        $first = $this->post("/api/v1/events/{$event->slug}/cover", ['file' => UploadedFile::fake()->image('a.jpg', 1600, 900)])->assertCreated()->json('data.id');
        $second = $this->post("/api/v1/events/{$event->slug}/cover", ['file' => UploadedFile::fake()->image('b.jpg', 1600, 900)])->assertCreated()->json('data.id');

        expect($event->fresh()?->getAttribute('cover_media_id'))->toBe($second)
            ->and(Media::query()->find($first))->toBeNull();
        $this->getJson("/api/v1/events/{$event->slug}")->assertJsonPath('data.cover.id', $second);

        Sanctum::actingAs(User::factory()->create());
        $this->post("/api/v1/events/{$event->slug}/cover", ['file' => UploadedFile::fake()->image('c.jpg', 800, 450)])->assertForbidden();
    });
});

describe('organiser updates', function () {
    it('posts an update to everybody with an answer and shows it to them only', function () {
        $event = evEvent($this->organiser);
        $going = User::factory()->create();
        evRsvp($event, $going);
        $stranger = User::factory()->create();

        Sanctum::actingAs($this->organiser);
        $this->postJson("/api/v1/events/{$event->slug}/updates", ['body' => 'Einfahrt über Tor 2.'])->assertCreated()->assertJsonPath('data.body', 'Einfahrt über Tor 2.');
        expect(Notification::query()->where('notifiable_id', $going->id)->where('type', NotificationType::EventUpdate)->count())->toBe(1);

        Sanctum::actingAs($going);
        $this->getJson("/api/v1/events/{$event->slug}/updates")->assertOk()->assertJsonCount(1, 'data');
        $this->postJson("/api/v1/events/{$event->slug}/updates", ['body' => 'Ich bin nicht der Organisator'])->assertForbidden();
        Sanctum::actingAs($stranger);
        $this->getJson("/api/v1/events/{$event->slug}/updates")->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/events/{$event->slug}/updates")->assertUnauthorized();
    });
});
