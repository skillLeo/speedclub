<?php

use App\Enums\NotificationType;
use App\Enums\RsvpStatus;
use App\Models\EventRsvp;
use App\Models\Notification;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EventTestHelpers.php';

/**
 * M4.12 RSVP with waitlist (09 §8.7): PUT/DELETE events/{slug}/rsvp, the attendee list (EVT-04) and taking members off it (EVT-06).
 */
beforeEach(function () {
    evFlags();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
    $this->event = evEvent($this->organiser, ['capacity' => 2]);
});

describe('PUT events/{slug}/rsvp', function () {
    it('applies the authorisation matrix', function (Closure $who, int $status, ?string $code) {
        socActAs($who($this->organiser));

        $response = $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'going'])->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [403, 'email_not_verified'],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [403, 'forbidden'],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [404, 'event_unavailable'],
        'member the other blocked' => [404, 'event_unavailable'],
    ]));

    it('fills the capacity, then the waitlist, idempotently and in order', function () {
        [$a, $b, $c, $d] = User::factory()->count(4)->create()->all();

        foreach ([$a, $b] as $member) {
            Sanctum::actingAs($member);
            $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'going'])->assertOk()->assertJsonPath('data.status', 'going');
        }

        Sanctum::actingAs($c);
        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'going'])->assertOk()
            ->assertJsonPath('data.status', 'waitlist')
            ->assertJsonPath('data.waitlist_position', 1)
            ->assertJsonPath('data.counts', ['going' => 2, 'interested' => 0])
            ->assertJsonPath('data.spots_left', 0);
        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'going'])->assertOk()->assertJsonPath('data.status', 'waitlist');
        $this->travel(1)->seconds();
        Sanctum::actingAs($d);
        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'going'])->assertOk()->assertJsonPath('data.waitlist_position', 2);

        // A going member leaves: the first on the waitlist moves up and is told; the second moves to first place.
        Sanctum::actingAs($a);
        $this->deleteJson("/api/v1/events/{$this->event->slug}/rsvp")->assertOk()->assertJsonPath('data.status', null);
        expect(EventRsvp::query()->where('user_id', $c->id)->value('status'))->toBe(RsvpStatus::Going)
            ->and(Notification::query()->where('notifiable_id', $c->id)->where('type', NotificationType::EventPromoted)->count())->toBe(1);

        Sanctum::actingAs($d);
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.my_rsvp', 'waitlist')->assertJsonPath('data.waitlist_position', 1);

        // Switching to interested frees a spot too.
        Sanctum::actingAs($b);
        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'interested'])->assertOk()->assertJsonPath('data.status', 'interested');
        expect(EventRsvp::query()->where('user_id', $d->id)->value('status'))->toBe(RsvpStatus::Going);
    });

    it('refuses the organiser, a closed event and a bad status', function () {
        Sanctum::actingAs($this->organiser);
        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'going'])->assertForbidden();

        Sanctum::actingAs(User::factory()->create());
        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'waitlist'])->assertUnprocessable();
        $this->event->forceFill(['status' => 'cancelled'])->save();
        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'going'])->assertStatus(409)->assertJsonPath('code', 'event_closed');
        $past = evEvent(null, ['starts_at' => now()->subDay(), 'ends_at' => now()->subDay()->addHours(2)]);
        $this->putJson("/api/v1/events/{$past->slug}/rsvp", ['status' => 'going'])->assertStatus(409);
    });

    it('lets a member withdraw any time, also after a block', function () {
        $member = User::factory()->create();
        evRsvp($this->event, $member);
        socBlock($this->organiser, $member);
        Sanctum::actingAs($member);

        $this->deleteJson("/api/v1/events/{$this->event->slug}/rsvp")->assertOk();
        expect(EventRsvp::query()->count())->toBe(0);
        $this->deleteJson("/api/v1/events/{$this->event->slug}/rsvp")->assertNotFound();
    });

    it('is rate limited', function () {
        socLimit('rsvps');
        Sanctum::actingAs(User::factory()->create());

        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'interested'])->assertOk();
        $this->putJson("/api/v1/events/{$this->event->slug}/rsvp", ['status' => 'going'])->assertStatus(429);
    });
});

describe('attendees', function () {
    it('shows members going members who may be found, and the organiser every answer with its time', function () {
        $going = User::factory()->create(['username' => 'lukas.sc']);
        $hidden = User::factory()->create(['discoverable' => false]);
        $interested = User::factory()->create();
        evRsvp($this->event, $going);
        evRsvp($this->event, $hidden);
        evRsvp($this->event, $interested, RsvpStatus::Interested);
        $viewer = User::factory()->create();

        $this->getJson("/api/v1/events/{$this->event->slug}/attendees")->assertUnauthorized();
        Sanctum::actingAs($viewer);
        $this->getJson("/api/v1/events/{$this->event->slug}/attendees?status=interested")->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.member.username', 'lukas.sc')
            ->assertJsonPath('data.0.status_at', null);

        socBlock($going, $viewer);
        $this->getJson("/api/v1/events/{$this->event->slug}/attendees")->assertOk()->assertJsonCount(0, 'data');

        Sanctum::actingAs($this->organiser);
        $this->getJson("/api/v1/events/{$this->event->slug}/attendees")->assertOk()->assertJsonCount(3, 'data');
        $this->getJson("/api/v1/events/{$this->event->slug}/attendees?status=interested")->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status_at', fn (mixed $at): bool => is_string($at));
    });

    it('lets the organiser take a member off the list, who cannot answer again', function () {
        $member = User::factory()->create(['username' => 'stoerer.1']);
        $waiting = User::factory()->create();
        $full = evEvent($this->organiser, ['capacity' => 1]);
        evRsvp($full, $member);
        evRsvp($full, $waiting, RsvpStatus::Waitlist);

        Sanctum::actingAs(User::factory()->create());
        $this->deleteJson("/api/v1/events/{$full->slug}/attendees/stoerer.1")->assertForbidden();

        Sanctum::actingAs($this->organiser);
        $this->deleteJson("/api/v1/events/{$full->slug}/attendees/stoerer.1")->assertNoContent();
        $this->deleteJson("/api/v1/events/{$full->slug}/attendees/stoerer.1")->assertNotFound();
        expect(EventRsvp::query()->where('user_id', $waiting->id)->value('status'))->toBe(RsvpStatus::Going);

        Sanctum::actingAs($member);
        $this->putJson("/api/v1/events/{$full->slug}/rsvp", ['status' => 'interested'])->assertForbidden();
        $this->getJson("/api/v1/events/{$full->slug}")->assertOk()->assertJsonPath('data.my_rsvp', null);
    });
});
