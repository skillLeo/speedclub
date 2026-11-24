<?php

use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\EventCheckinCode;
use App\Models\User;
use App\Services\Events\EventCheckins;
use App\Services\Events\EventHousekeeping;
use App\Services\Qr\QrRenderer;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';

/**
 * M5.6 the organiser's rotating check-in code (m5.6-contract §5.1, §5.3): 6 characters without 0/O/1/I/L, a new one every 5 minutes,
 * the one before accepted 60 s longer, compared case-insensitively and in constant time, 5 wrong codes per event and hour.
 */
beforeEach(function () {
    m56Flags();
    $this->organiser = evOrganiser();
    $this->event = evEvent($this->organiser, ['starts_at' => now()->subMinutes(30), 'ends_at' => now()->addHours(2)]);
    $this->member = User::factory()->create();
});

function m56Code(object $test, Event $event): array
{
    Sanctum::actingAs($test->organiser);

    return $test->getJson("/api/v1/events/{$event->slug}/checkin-code")->assertOk()->json('data');
}

it('shows the organiser a code, its link, the server-drawn QR and the live count', function () {
    $this->freezeTime();
    m56Checkin($this->event, User::factory()->create());
    $data = m56Code($this, $this->event);

    expect($data['code'])->toMatch('/\A[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}\z/')
        ->and($data['url'])->toBe(rtrim((string) config('app.url'), '/')."/app/events/{$this->event->slug}/checkin?code={$data['code']}")
        ->and($data['svg'])->toBe(app(QrRenderer::class)->svg($data['url']))
        ->and($data['svg'])->toContain('<svg')
        ->and($data['expires_at'])->toBe(now()->addSeconds(300)->toIso8601String())
        ->and($data['refresh_at'])->toBe(now()->addSeconds(270)->toIso8601String())
        ->and($data['checked_in'])->toBe(1);
});

it('keeps the code until its refresh moment, then rotates, and accepts the one before until 60 s after it expired', function () {
    // A frozen clock: under load real seconds would add to the travelled ones and cross the boundaries early.
    $this->freezeTime();
    $first = m56Code($this, $this->event)['code'];
    $this->travel(269)->seconds();
    expect(m56Code($this, $this->event)['code'])->toBe($first);

    // Review M5.6: from refresh_at (30 s before expiry) the poll gets the next code, not the same one again.
    $this->travel(2)->seconds();
    $second = m56Code($this, $this->event)['code'];
    expect($second)->not->toBe($first)
        ->and(EventCheckinCode::query()->where('event_id', $this->event->id)->count())->toBe(2);

    $checkins = app(EventCheckins::class);
    expect($checkins->matches($this->event, $first))->toBeTrue()
        ->and($checkins->matches($this->event, $second))->toBeTrue();

    // The first code expired at 300 s; its grace ends at 360 s.
    $this->travel(88)->seconds();
    expect($checkins->matches($this->event, $first))->toBeTrue();
    $this->travel(2)->seconds();
    expect($checkins->matches($this->event, $first))->toBeFalse()
        ->and($checkins->matches($this->event, $second))->toBeTrue();
});

it('compares case-insensitively, ignores spaces and dashes, and never matches another event\'s code', function () {
    $code = m56Code($this, $this->event)['code'];
    $other = evEvent($this->organiser, ['starts_at' => now()->subMinutes(30), 'ends_at' => now()->addHours(2)]);
    $checkins = app(EventCheckins::class);

    expect($checkins->matches($this->event, strtolower(substr($code, 0, 3)).' '.substr($code, 3)))->toBeTrue()
        ->and($checkins->matches($this->event, substr($code, 0, 3).'-'.substr($code, 3)))->toBeTrue()
        ->and($checkins->matches($other, $code))->toBeFalse()
        ->and($checkins->matches($this->event, substr($code, 0, 5)))->toBeFalse()
        ->and($checkins->matches($this->event, ''))->toBeFalse();
});

it('compares every candidate with hash_equals and without an early exit', function () {
    $source = (string) file_get_contents(app_path('Services/Events/EventCheckins.php'));
    preg_match('/public function matches\(.*?\n    \}/s', $source, $body);

    expect($body[0] ?? '')->toContain('hash_equals')->not->toContain('return true')->not->toContain('break');
});

it('generates codes of the alphabet only', function () {
    foreach (range(1, 200) as $i) {
        expect(EventCheckins::generate())->toMatch('/\A[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}\z/');
    }
});

it('stops a member after five wrong codes for an event in an hour, even with the right one', function () {
    $code = m56Code($this, $this->event)['code'];
    $wrong = $code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
    Sanctum::actingAs($this->member);

    foreach (range(1, 5) as $i) {
        $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $wrong])->assertUnprocessable()
            ->assertJsonPath('code', 'checkin_code_invalid')->assertJsonValidationErrors('code');
    }

    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $code])->assertStatus(429)
        ->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
    expect(EventCheckin::query()->count())->toBe(0);

    $this->travel(61)->minutes();
    $fresh = m56Code($this, $this->event)['code'];
    Sanctum::actingAs($this->member);
    $this->postJson("/api/v1/events/{$this->event->slug}/checkin", ['code' => $fresh])->assertCreated();
});

it('shows the code only to the organiser, only inside the window', function () {
    $this->getJson("/api/v1/events/{$this->event->slug}/checkin-code")->assertUnauthorized();

    Sanctum::actingAs($this->member);
    $this->getJson("/api/v1/events/{$this->event->slug}/checkin-code")->assertForbidden();

    $going = User::factory()->create();
    evRsvp($this->event, $going);
    Sanctum::actingAs($going);
    $this->getJson("/api/v1/events/{$this->event->slug}/checkin-code")->assertForbidden();

    $later = evEvent($this->organiser, ['starts_at' => now()->addHours(3), 'ends_at' => now()->addHours(5)]);
    Sanctum::actingAs($this->organiser);
    $this->getJson("/api/v1/events/{$later->slug}/checkin-code")->assertStatus(409)->assertJsonPath('code', 'checkin_closed')
        ->assertJsonPath('meta.opens_at', $later->starts_at?->subHour()->toIso8601String());

    $this->travel(2)->hours();
    $this->getJson("/api/v1/events/{$later->slug}/checkin-code")->assertOk();
});

it('prunes codes past their grace in the daily housekeeping', function () {
    EventCheckinCode::factory()->create(['event_id' => $this->event->id, 'expires_at' => now()->subMinutes(5)]);
    EventCheckinCode::factory()->create(['event_id' => $this->event->id, 'expires_at' => now()->addMinutes(3)]);

    expect(app(EventHousekeeping::class)->run()['codes_pruned'])->toBe(1)
        ->and(EventCheckinCode::query()->count())->toBe(1);
});
