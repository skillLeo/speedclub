<?php

use App\Models\Event;
use Carbon\CarbonImmutable;

require_once __DIR__.'/M56TestHelpers.php';

/**
 * M5.6 "Diese Woche" (m5.6-contract §1): `when=week` is the next seven Berlin days, today 00:00 to today + 6 days 23:59:59, for the list
 * and the pins alike; events overlapping the window, by start.
 */
beforeEach(function () {
    evFlags();
});

function m56Berlin(string $local): CarbonImmutable
{
    return CarbonImmutable::parse($local, 'Europe/Berlin');
}

function m56EventAt(string $startLocal, int $hours = 2, array $attributes = []): Event
{
    $start = m56Berlin($startLocal);

    return evEvent(null, ['starts_at' => $start->utc(), 'ends_at' => $start->addHours($hours)->utc(), ...$attributes]);
}

/** @return list<string> */
function m56WeekSlugs(object $test, string $path = '/api/v1/events?when=week&per_page=50'): array
{
    return array_column($test->getJson($path)->assertOk()->json('data'), 'slug');
}

it('runs from a Saturday through next Friday night, not into next Saturday', function () {
    $this->travelTo(m56Berlin('2026-11-21 10:00'));
    $friday = m56EventAt('2026-11-27 23:30', 1);
    $saturday = m56EventAt('2026-11-28 00:10');
    $wednesday = m56EventAt('2026-11-25 18:00');
    $since = evEvent(null, ['starts_at' => m56Berlin('2026-11-20 20:00')->utc(), 'ends_at' => m56Berlin('2026-11-21 22:00')->utc()]);
    $over = evEvent(null, ['starts_at' => m56Berlin('2026-11-21 06:00')->utc(), 'ends_at' => m56Berlin('2026-11-21 08:00')->utc()]);

    $slugs = m56WeekSlugs($this);

    expect($slugs)->toBe([$since->slug, $wednesday->slug, $friday->slug])
        ->and($slugs)->not->toContain($saturday->slug)
        ->and($slugs)->not->toContain($over->slug);
});

it('takes the same window for the map pins', function () {
    $this->travelTo(m56Berlin('2026-11-21 10:00'));
    $in = m56EventAt('2026-11-27 20:00');
    $out = m56EventAt('2026-11-28 12:00');

    $ids = array_column($this->getJson('/api/v1/events/pins?when=week')->assertOk()->json('data'), 'id');

    expect($ids)->toContain($in->id)->not->toContain($out->id);
});

it('has no gap and no overlap across the end of summer time (last Sunday of October)', function () {
    $this->travelTo(m56Berlin('2026-10-20 12:00'));
    $doubled = m56EventAt('2026-10-25 02:30', 1);
    $lastEvening = m56EventAt('2026-10-26 23:30', 1);
    $nextMorning = m56EventAt('2026-10-27 00:05');

    $slugs = m56WeekSlugs($this);

    expect($slugs)->toContain($doubled->slug)->toContain($lastEvening->slug)->not->toContain($nextMorning->slug);
});

it('has no gap and no overlap across the start of summer time (last Sunday of March)', function () {
    $this->travelTo(m56Berlin('2027-03-23 09:00'));
    $lastEvening = m56EventAt('2027-03-29 23:30', 1);
    $nextMorning = m56EventAt('2027-03-30 00:10');
    $sunday = m56EventAt('2027-03-28 03:30');

    $slugs = m56WeekSlugs($this);

    expect($slugs)->toContain($lastEvening->slug)->toContain($sunday->slug)->not->toContain($nextMorning->slug);
});

it('refuses an unknown window', function () {
    $this->getJson('/api/v1/events?when=fortnight')->assertUnprocessable()->assertJsonValidationErrors('when');
});
