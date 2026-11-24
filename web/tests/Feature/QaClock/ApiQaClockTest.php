<?php

use App\Enums\MaintenanceType;
use App\Http\Controllers\Admin\Support\QaClock as AdminQaClock;
use App\Models\CarOfTheDay;
use App\Models\QrScanDaily;
use App\Models\User;
use App\Support\QaClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Events/EventTestHelpers.php';
require_once __DIR__.'/../Gift/GiftTestHelpers.php';
require_once __DIR__.'/../Maintenance/MaintenanceTestHelpers.php';
require_once __DIR__.'/../Stickers/StickerTestHelpers.php';

/**
 * DQ-P5-201: the API's date windows (Car of the Day, EVT-01 week/weekend/upcoming, DISC-01 "Treffen am Wochenende", the MNT-01/GAR-01
 * countdowns, the STK-04 days and weeks) count from the visual matrix's QA clock (`X-Qa-Now`, or `?qaNow=`) outside production, never in
 * production, and from the real clock without it. The real clock here is Tuesday 17 November 2026; the QA clock is the matrix's
 * Monday 2 November 2026, 11:00 in Berlin.
 */
const QA_CLOCK_NOW = '2026-11-02T10:00:00.000Z';

function qaClockBerlin(string $local): CarbonImmutable
{
    return CarbonImmutable::parse($local, 'Europe/Berlin');
}

/** @return array<string, string> */
function qaClockHeader(): array
{
    return [QaClock::HEADER => QA_CLOCK_NOW];
}

function qaClockProduction(): void
{
    app()->detectEnvironment(fn () => 'production');
}

/**
 * [state, days_left] of MNT-01's items by type.
 *
 * @param  array<string, string>  $headers
 * @return array<string, array{0: string, 1: int|null}>
 */
function qaClockItems(object $test, array $headers = []): array
{
    return collect($test->getJson('/api/v1/vehicles/'.$test->vehicle->id.'/maintenance-items', $headers)->assertOk()->json('data'))
        ->keyBy('type')->map(fn (array $item): array => [$item['state'], $item['days_left']])->all();
}

beforeEach(function () {
    $this->travelTo(qaClockBerlin('2026-11-17 12:00'));
});

describe('the helper', function () {
    it('reads the header, then the query, outside production', function () {
        $header = Request::create('/api/v1/events', 'GET', ['qaNow' => '2026-01-01T00:00:00Z'], server: ['HTTP_X_QA_NOW' => QA_CLOCK_NOW]);
        $query = Request::create('/api/v1/events', 'GET', ['qaNow' => QA_CLOCK_NOW]);

        expect(QaClock::frozen($header)?->toIso8601String())->toBe('2026-11-02T10:00:00+00:00')
            ->and(QaClock::frozen($query)?->toIso8601String())->toBe('2026-11-02T10:00:00+00:00')
            ->and(QaClock::now($query)->toIso8601String())->toBe('2026-11-02T10:00:00+00:00');
    });

    it('answers in the app zone whatever offset the value was sent with', function () {
        $request = Request::create('/', 'GET', ['qaNow' => '2026-11-02T11:00:00+01:00']);

        expect(QaClock::frozen($request)?->getTimezone()->getName())->toBe('UTC')
            ->and(QaClock::frozen($request)?->toIso8601String())->toBe('2026-11-02T10:00:00+00:00');
    });

    it('keeps the real clock without a value or with one that is not a date', function (?string $value) {
        $request = Request::create('/', 'GET', $value === null ? [] : ['qaNow' => $value]);

        expect(QaClock::frozen($request))->toBeNull()
            ->and(QaClock::now($request)->equalTo(qaClockBerlin('2026-11-17 12:00')))->toBeTrue();
    })->with([
        'none' => [null],
        'empty' => [''],
        'not a date' => ['gestern abend'],
        'too long' => [str_repeat('2026-11-02 ', 5)],
    ]);

    it('ignores the header and the query in production', function () {
        qaClockProduction();
        $request = Request::create('/', 'GET', ['qaNow' => QA_CLOCK_NOW], server: ['HTTP_X_QA_NOW' => QA_CLOCK_NOW]);

        expect(QaClock::frozen($request))->toBeNull()
            ->and(QaClock::now($request)->equalTo(qaClockBerlin('2026-11-17 12:00')))->toBeTrue()
            ->and(AdminQaClock::frozen($request))->toBeNull();
    });

    it('is the clock the admin pages read too', function () {
        $request = Request::create('/admin', 'GET', ['qaNow' => QA_CLOCK_NOW]);

        expect(AdminQaClock::today($request)->toDateString())->toBe('2026-11-02');
    });
});

describe('Car of the Day on Home', function () {
    beforeEach(function () {
        $this->qaPick = giftCar(giftMember(), 600);
        $this->realPick = giftCar(giftMember(), 600);
        // On Home from 18:00 of its day to 18:00 of the next: at 11:00 on 2 Nov that is 1 Nov's pick, at 12:00 on 17 Nov 16 Nov's.
        CarOfTheDay::factory()->create(['day' => '2026-11-01', 'vehicle_id' => $this->qaPick->id]);
        CarOfTheDay::factory()->create(['day' => '2026-11-16', 'vehicle_id' => $this->realPick->id]);
    });

    it('shows the pick of the QA clock\'s day with the header or the query', function () {
        expect($this->getJson('/api/v1/home/modules', qaClockHeader())->assertOk()->json('data.car_of_the_day'))
            ->toMatchArray(['day' => '2026-11-01'])
            ->and($this->getJson('/api/v1/home/modules?qaNow='.urlencode(QA_CLOCK_NOW))->json('data.car_of_the_day.vehicle.id'))->toBe($this->qaPick->id);
    });

    it('shows today\'s pick without the QA clock and in production', function () {
        expect($this->getJson('/api/v1/home/modules')->assertOk()->json('data.car_of_the_day.day'))->toBe('2026-11-16');

        qaClockProduction();
        expect($this->getJson('/api/v1/home/modules', qaClockHeader())->assertOk()->json('data.car_of_the_day.vehicle.id'))->toBe($this->realPick->id);
    });

    it('never moves the owner\'s story editor, a write on the real clock', function () {
        Sanctum::actingAs(User::query()->findOrFail($this->qaPick->owner_id));

        $this->patchJson('/api/v1/vehicles/'.$this->qaPick->id.'/car-of-the-day', ['story_line' => 'Zwei Winter in der Halle.'], qaClockHeader())
            ->assertStatus(409)->assertJsonPath('code', 'not_car_of_the_day');
    });
});

describe('EVT-01 and DISC-01 windows', function () {
    beforeEach(function () {
        evFlags();
        $at = fn (string $local) => evEvent(null, ['starts_at' => qaClockBerlin($local)->utc(), 'ends_at' => qaClockBerlin($local)->addHours(3)->utc()]);
        // The QA week (Mon 2 – Sun 8 Nov) and weekend (7–8 Nov); the real week (Tue 17 – Mon 23 Nov) and weekend (21–22 Nov).
        $this->qaWeekday = $at('2026-11-05 18:00');
        $this->qaWeekend = $at('2026-11-07 14:00');
        $this->realWeekday = $at('2026-11-19 18:00');
        $this->realWeekend = $at('2026-11-21 14:00');
    });

    it('counts week, weekend and upcoming from the QA clock', function () {
        $slugs = fn (string $when): array => array_column($this->getJson('/api/v1/events?per_page=50&when='.$when, qaClockHeader())->assertOk()->json('data'), 'slug');

        expect($slugs('week'))->toBe([$this->qaWeekday->slug, $this->qaWeekend->slug])
            ->and($slugs('weekend'))->toBe([$this->qaWeekend->slug])
            ->and($slugs('upcoming'))->toBe([$this->qaWeekday->slug, $this->qaWeekend->slug, $this->realWeekday->slug, $this->realWeekend->slug])
            ->and(array_column($this->getJson('/api/v1/events/pins?when=week', qaClockHeader())->assertOk()->json('data'), 'id'))
            ->toEqualCanonicalizing([$this->qaWeekday->id, $this->qaWeekend->id]);
    });

    it('fills DISC-01 "Treffen am Wochenende" from the QA clock', function () {
        expect(array_column($this->getJson('/api/v1/discover', qaClockHeader())->assertOk()->json('data.weekend_events'), 'slug'))
            ->toBe([$this->qaWeekend->slug]);
    });

    it('keeps the real clock without the QA clock', function () {
        $slugs = fn (string $when): array => array_column($this->getJson('/api/v1/events?per_page=50&when='.$when)->assertOk()->json('data'), 'slug');

        expect($slugs('week'))->toBe([$this->realWeekday->slug, $this->realWeekend->slug])
            ->and($slugs('weekend'))->toBe([$this->realWeekend->slug])
            ->and($slugs('upcoming'))->toBe([$this->realWeekday->slug, $this->realWeekend->slug])
            ->and(array_column($this->getJson('/api/v1/discover')->json('data.weekend_events'), 'slug'))->toBe([$this->realWeekend->slug]);
    });

    it('ignores the QA clock in production', function () {
        qaClockProduction();

        expect(array_column($this->getJson('/api/v1/events?per_page=50&when=week', qaClockHeader())->assertOk()->json('data'), 'slug'))
            ->toBe([$this->realWeekday->slug, $this->realWeekend->slug])
            ->and(array_column($this->getJson('/api/v1/events?per_page=50', qaClockHeader())->json('data'), 'slug'))
            ->not->toContain($this->qaWeekday->slug)
            ->and(array_column($this->getJson('/api/v1/discover', qaClockHeader())->json('data.weekend_events'), 'slug'))->toBe([$this->realWeekend->slug]);
    });
});

describe('MNT-01 and GAR-01 countdowns', function () {
    beforeEach(function () {
        mntFlags();
        $this->owner = User::factory()->create();
        $this->vehicle = publishedVehicle($this->owner);
        // Due 10 Nov (lead 14 days): 8 days ahead and "soon" on 2 Nov, 7 days over on 17 Nov. Due 25 Dec: 53 or 38 days ahead.
        $this->soon = mntItem($this->vehicle, MaintenanceType::OilChange, ['last_done_at' => '2025-11-10', 'next_due_at' => '2026-11-10', 'next_due_km' => null, 'lead_days' => [14]]);
        $this->later = mntItem($this->vehicle, MaintenanceType::BrakeFluid, ['last_done_at' => '2024-12-25', 'next_due_at' => '2026-12-25', 'next_due_km' => null, 'lead_days' => [14]]);
        Sanctum::actingAs($this->owner);
    });

    it('counts days_left, state and progress from the QA clock', function () {
        $items = $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/maintenance-items', qaClockHeader())->assertOk()->json('data');
        $soon = collect($items)->firstWhere('type', 'oil_change');

        expect(qaClockItems($this, qaClockHeader()))->toBe(['oil_change' => ['soon', 8], 'brake_fluid' => ['ok', 53]])
            ->and($soon['progress'])->toBe(round(357 / 365, 3))
            ->and($soon['next_due']['date'])->toBe('2026-11-10');
    });

    it('takes the same clock for Garage "Nächste Fälligkeiten" and its window', function () {
        $upcoming = $this->getJson('/api/v1/me/maintenance/upcoming?days=40', qaClockHeader())->assertOk()->json('data');

        expect(array_map(fn (array $row): array => [$row['type'], $row['state'], $row['days_left']], $upcoming))->toBe([['oil_change', 'soon', 8]]);
    });

    it('keeps the real today without the QA clock and in production', function () {
        $real = ['oil_change' => ['overdue', -7], 'brake_fluid' => ['ok', 38]];
        expect(qaClockItems($this))->toBe($real)
            ->and(array_column($this->getJson('/api/v1/me/maintenance/upcoming?days=40')->assertOk()->json('data'), 'days_left'))->toBe([-7, 38]);

        qaClockProduction();
        expect(qaClockItems($this, qaClockHeader()))->toBe($real)
            ->and(array_column($this->getJson('/api/v1/me/maintenance/upcoming?days=40', qaClockHeader())->assertOk()->json('data'), 'days_left'))->toBe([-7, 38]);
    });
});

describe('STK-04 days and weeks', function () {
    beforeEach(function () {
        stkStatsFlag();
        $this->owner = User::factory()->create();
        [$this->vehicle, $qr] = stkCar($this->owner);
        foreach (['2026-10-28' => 5, '2026-11-02' => 3, '2026-11-17' => 4] as $day => $count) {
            QrScanDaily::query()->create(['qr_code_id' => $qr->id, 'day' => $day, 'count' => $count]);
        }
        Sanctum::actingAs($this->owner);
    });

    it('ends the 30 days and the weeks on the QA clock\'s day', function () {
        $data = $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker/stats', qaClockHeader())->assertOk()->json('data');

        expect($data['days'])->toHaveCount(30)
            ->and($data['days'][0]['date'])->toBe('2026-10-04')
            ->and($data['days'][29])->toBe(['date' => '2026-11-02', 'count' => 3])
            ->and($data['total_30_days'])->toBe(8)
            ->and($data['this_week'])->toBe(3)
            ->and($data['last_week'])->toBe(5)
            ->and($data['total'])->toBe(12);
    });

    it('keeps today without the QA clock and in production', function () {
        $real = fn (array $headers): array => $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker/stats', $headers)->assertOk()->json('data');
        $expected = fn (array $data) => expect([$data['days'][0]['date'], $data['days'][29], $data['total_30_days'], $data['this_week'], $data['last_week']])
            ->toBe(['2026-10-19', ['date' => '2026-11-17', 'count' => 4], 12, 4, 0]);

        $expected($real([]));
        qaClockProduction();
        $expected($real(qaClockHeader()));
    });
});
