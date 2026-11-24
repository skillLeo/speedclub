<?php

use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\EventRsvp;
use App\Models\User;
use App\Services\Events\EventCheckins;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';

/**
 * M5.6 check-in endpoints (m5.6-contract §5.2, §5.3): check in (201, then 200 idempotently), change the profile switch, take it back,
 * the window, the own event, the detail fields, me/checkins.
 */
beforeEach(function () {
    m56Flags();
    $this->organiser = evOrganiser();
    $this->event = evEvent($this->organiser, ['starts_at' => now()->subMinutes(30), 'ends_at' => now()->addHours(2)]);
    $this->member = User::factory()->create();
    // The organiser's current code, as GET checkin-code issues it (no sign-in here, so the matrix starts as a guest).
    $this->code = app(EventCheckins::class)->currentCode($this->event)->code;
});

it('checks a member in with 201 and answers 200 with the same body after that, the RSVP untouched', function () {
    Sanctum::actingAs($this->member);

    $first = $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code])->assertCreated()
        ->assertJsonPath('data.profile_visible', true)
        ->assertJsonPath('data.event.slug', $this->event->slug)
        ->assertJsonPath('data.event.id', $this->event->id);

    $again = $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => 'WRONG2'])->assertOk();

    expect($again->json('data'))->toBe($first->json('data'))
        ->and(EventCheckin::query()->count())->toBe(1)
        ->and(EventRsvp::query()->where('user_id', $this->member->id)->exists())->toBeFalse();
});

it('keeps a going member\'s answer as it was', function () {
    evRsvp($this->event, $this->member);
    Sanctum::actingAs($this->member);

    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code, 'profile_visible' => false])->assertCreated()
        ->assertJsonPath('data.profile_visible', false);

    expect(EventRsvp::query()->where('user_id', $this->member->id)->sole()->status)->toBe(RsvpStatus::Going);
});

it('replays a repeated Idempotency-Key', function () {
    Sanctum::actingAs($this->member);
    $headers = ['Idempotency-Key' => 'chk-0001-aaaa-bbbb'];

    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code], $headers)->assertCreated();
    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code], $headers)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
    expect(EventCheckin::query()->count())->toBe(1);
});

it('validates the body', function () {
    Sanctum::actingAs($this->member);

    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", [])->assertUnprocessable()->assertJsonValidationErrors('code');
    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code, 'profile_visible' => 'vielleicht'])
        ->assertUnprocessable()->assertJsonValidationErrors('profile_visible');
});

it('opens an hour before the start and closes two hours after the end', function () {
    $later = evEvent($this->organiser, ['starts_at' => now()->addHours(2), 'ends_at' => now()->addHours(4)]);
    Sanctum::actingAs($this->member);

    $this->postJson("/api/v1/events/{$later->slug}/checkin", ['code' => 'ABCDEF'])->assertStatus(409)
        ->assertJsonPath('code', 'checkin_closed')
        ->assertJsonPath('meta.opens_at', $later->starts_at?->subHour()->toIso8601String())
        ->assertJsonPath('meta.closes_at', $later->ends_at?->addHours(2)->toIso8601String());

    $this->travelTo($this->event->ends_at?->addHours(2)->addMinute());
    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code])->assertStatus(409)->assertJsonPath('code', 'checkin_closed');
});

it('refuses the organiser at their own event, and a cancelled event', function () {
    Sanctum::actingAs($this->organiser);
    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code])->assertForbidden()->assertJsonPath('code', 'checkin_own_event');

    $this->event->forceFill(['status' => 'cancelled', 'cancelled_at' => now()])->save();
    Sanctum::actingAs($this->member);
    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code])->assertStatus(409)->assertJsonPath('code', 'checkin_closed');
});

it('is limited by throttle:checkins', function () {
    socLimit('checkins');
    Sanctum::actingAs($this->member);

    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code])->assertCreated();
    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code])->assertStatus(429)->assertHeader('Retry-After');
});

it('applies the authorisation matrix', function (Closure $who, int $status, ?string $code) {
    $viewer = $who($this->organiser);
    socActAs($viewer);
    $response = $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code])->assertStatus($status);

    if ($code !== null) {
        $response->assertJsonPath('code', $code);
    }
})->with(socMatrix([
    'guest' => [401, 'unauthenticated'],
    'other member' => [201, null],
    'unverified member' => [403, 'email_not_verified'],
    'member restricted from publishing' => [201, null],
    'member restricted from messaging' => [201, null],
    'suspended member' => [403, 'forbidden'],
    'deactivated member' => [403, 'forbidden'],
    'member who blocked the other' => [404, 'event_unavailable'],
    'member the other blocked' => [404, 'event_unavailable'],
]));

it('changes the profile switch and takes the check-in back, for its member only', function () {
    m56Checkin($this->event, $this->member);
    $other = User::factory()->create();

    Sanctum::actingAs($other);
    $this->patchJson("/api/v1/events/{$this->event->slug}/checkin", ['profile_visible' => false])->assertNotFound()->assertJsonPath('code', 'event_unavailable');
    $this->deleteJson("/api/v1/events/{$this->event->slug}/checkin")->assertNotFound();

    Sanctum::actingAs($this->member);
    $this->patchJson("/api/v1/events/{$this->event->slug}/checkin", [])->assertUnprocessable()->assertJsonValidationErrors('profile_visible');
    $this->patchJson("/api/v1/events/{$this->event->slug}/checkin", ['profile_visible' => false])->assertOk()
        ->assertJsonPath('data.profile_visible', false)->assertJsonPath('data.event.slug', $this->event->slug);
    $this->deleteJson("/api/v1/events/{$this->event->slug}/checkin")->assertNoContent();
    expect(EventCheckin::query()->count())->toBe(0);
});

it('lets the member take the check-in back after a block or a cancellation', function () {
    m56Checkin($this->event, $this->member);
    socBlock($this->organiser, $this->member);
    $this->event->forceFill(['status' => 'cancelled', 'cancelled_at' => now()])->save();
    Sanctum::actingAs($this->member);

    $this->deleteJson("/api/v1/events/{$this->event->slug}/checkin")->assertNoContent();
});

it('carries checkin and the can flags on the detail', function () {
    m56Checkin(evEvent(), User::factory()->create());
    m56Checkin($this->event, User::factory()->create());
    Sanctum::actingAs($this->organiser);

    $this->getJson("/api/v1/events/{$this->event->slug}")->assertOk()
        ->assertJsonPath('data.checkin.open', true)
        ->assertJsonPath('data.checkin.opens_at', $this->event->starts_at?->subHour()->toIso8601String())
        ->assertJsonPath('data.checkin.closes_at', $this->event->ends_at?->addHours(2)->toIso8601String())
        ->assertJsonPath('data.checkin.count', 1)
        ->assertJsonPath('data.checkin.mine', null)
        ->assertJsonPath('data.can.show_checkin_code', true)
        ->assertJsonPath('data.can.checkin', false);

    Sanctum::actingAs($this->member);
    $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.checkin.count', null)
        ->assertJsonPath('data.can.checkin', true)->assertJsonPath('data.can.show_checkin_code', false);

    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $this->code])->assertCreated();
    $detail = $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.can.checkin', false)
        ->assertJsonPath('data.checkin.mine.profile_visible', true);
    expect($detail->json('data.checkin.mine.checked_in_at'))->not->toBeNull();
});

it('leaves checkin out for samples and unpublished events', function () {
    $sample = evEvent($this->organiser, ['is_sample' => true, 'starts_at' => now()->subMinutes(30), 'ends_at' => now()->addHour()]);
    $draft = Event::factory()->draft()->create(['organiser_id' => $this->organiser->id]);
    Sanctum::actingAs($this->organiser);

    $this->getJson("/api/v1/events/{$sample->slug}")->assertOk()->assertJsonMissingPath('data.checkin')->assertJsonPath('data.can.show_checkin_code', false);
    $this->getJson("/api/v1/events/{$draft->slug}")->assertOk()->assertJsonMissingPath('data.checkin');
});

it('lists the member\'s own check-ins newest first, running and hidden ones included', function () {
    $past = evEvent($this->organiser, ['starts_at' => now()->subWeek(), 'ends_at' => now()->subWeek()->addHours(3)]);
    $older = m56Checkin($past, $this->member, ['checked_in_at' => now()->subWeek(), 'profile_visible' => false]);
    $newer = m56Checkin($this->event, $this->member);
    m56Checkin($this->event, User::factory()->create());
    Sanctum::actingAs($this->member);

    $page = $this->getJson('/api/v1/me/checkins?per_page=1')->assertOk()
        ->assertJsonPath('data.0.slug', $this->event->slug)
        ->assertJsonPath('data.0.profile_visible', true)
        ->assertJsonPath('data.0.checked_in_at', $newer->checked_in_at->toIso8601String());
    $cursor = $page->json('meta.next_cursor');

    $this->getJson("/api/v1/me/checkins?per_page=1&cursor=$cursor")->assertOk()
        ->assertJsonPath('data.0.slug', $past->slug)->assertJsonPath('data.0.profile_visible', false)
        ->assertJsonPath('data.0.checked_in_at', $older->checked_in_at->toIso8601String());

    $this->getJson('/api/v1/me/checkins?per_page=51')->assertUnprocessable()->assertJsonValidationErrors('per_page');
});
