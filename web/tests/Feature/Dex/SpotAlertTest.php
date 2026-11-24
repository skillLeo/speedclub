<?php

use App\Enums\NotificationType;
use App\Models\DeCity;
use App\Models\Notification;
use App\Models\Spot;
use App\Models\SpotAlert;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Dex\SpotAlerts;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\SocialPushLimiter;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';
require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M5.9b part 2 (m5.9b contract §4, owner gift detail): the grouped 3-hourly owner alert, its city wording, the night and hidden-city
 * rules, the shared social push limit (one push per member and Berlin day across the gift social types), the fixed quiet hours 22–08
 * plus the member's own, the SET-09 switch and sample cars; resumable, idempotent and locked.
 */

/** A moment in Europe/Berlin on the fixed test day. */
function alertAt(string $time, string $day = '2026-07-15'): CarbonImmutable
{
    return CarbonImmutable::parse("$day $time", 'Europe/Berlin')->utc();
}

/**
 * A counted spot of $vehicle at $at (Berlin), by a fresh spotter unless given.
 */
function alertSpot(Vehicle $vehicle, CarbonImmutable $at, ?DeCity $city = null, bool $night = false, ?User $spotter = null, bool $counted = true): Spot
{
    return Spot::factory()->create([
        'vehicle_id' => $vehicle->id,
        'spotter_id' => ($spotter ?? dexMember())->id,
        'city_id' => $city?->id,
        'is_night' => $night,
        'counted' => $counted,
        'created_at' => $at,
    ]);
}

function alertRun(CarbonImmutable $now): ?int
{
    test()->travelTo($now);

    return app(SpotAlerts::class)->run();
}

/** The owner's spot_alert rows. */
function alertRows(User $owner): Collection
{
    return Notification::query()->where('notifiable_id', $owner->id)->where('type', NotificationType::SpotAlert->value)->orderBy('group_key')->get();
}

/** The push bodies Expo was sent. @return list<string> */
function alertPushBodies(): array
{
    return array_values(array_map(fn (array $payload): string => (string) ($payload[0]['body'] ?? ''), ntfPushes()));
}

beforeEach(function () {
    $this->owner = dexMember(['locale' => 'de']);
    [$this->car] = dexCar($this->owner);
    $this->duesseldorf = dexCity('Düsseldorf');
    $this->koeln = dexCity('Köln');
    $this->essen = dexCity('Essen');
});

it('groups the day\'s spots of a car into one row and one push, naming the city', function () {
    ntfPushOn($this->owner);
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);
    alertSpot($this->car, alertAt('10:20'), $this->duesseldorf);
    alertSpot($this->car, alertAt('11:30'), $this->duesseldorf);
    alertSpot($this->car, alertAt('11:40'), $this->duesseldorf);

    expect(alertRun(alertAt('12:00')))->toBe(1);

    $rows = alertRows($this->owner);
    expect($rows)->toHaveCount(1)
        ->and($rows[0]->group_key)->toBe('spot_alert:'.$this->car->id.':2026-07-15')
        ->and($rows[0]->data)->toMatchArray(['day' => '2026-07-15', 'count' => 4, 'city_ids' => [$this->duesseldorf->id]])
        ->and($rows[0]->actor_count)->toBe(0)
        ->and(alertPushBodies())->toHaveCount(1)
        ->and(alertPushBodies()[0])->toEndWith('wurde heute 4-mal in Düsseldorf gespottet.')
        ->and(SpotAlert::query()->where('vehicle_id', $this->car->id)->count())->toBe(1);

    // HOME-02: the details the app writes its sentence from, never who spotted the car.
    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson('/api/v1/notifications')->assertOk()->json('data'))->firstWhere('type', 'spot_alert');
    expect($row['details'])->toBe(['day' => '2026-07-15', 'count' => 4, 'cities_count' => 1, 'city' => 'Düsseldorf'])
        ->and($row['actors'])->toBe([])
        ->and($row['vehicle']['id'])->toBe($this->car->id);
});

it('says "in 3 Städten" for several cities, and in English too', function () {
    ntfPushOn($this->owner);
    $this->owner->forceFill(['locale' => 'en'])->save();
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);
    alertSpot($this->car, alertAt('09:20'), $this->koeln);
    alertSpot($this->car, alertAt('09:30'), $this->essen);

    alertRun(alertAt('12:00'));

    expect(alertPushBodies()[0])->toEndWith('was spotted 3 times in 3 cities today.');
    Sanctum::actingAs($this->owner);
    expect(collect($this->getJson('/api/v1/notifications')->json('data'))->firstWhere('type', 'spot_alert')['details'])
        ->toMatchArray(['count' => 3, 'cities_count' => 3, 'city' => null]);
});

it('names no city for night-only spots, counts them, and never names a night spot\'s city next to day spots', function () {
    ntfPushOn($this->owner);
    alertSpot($this->car, alertAt('01:10'), $this->koeln, night: true);
    alertSpot($this->car, alertAt('02:10'), $this->koeln, night: true);

    alertRun(alertAt('09:00'));

    expect(alertRows($this->owner)[0]->data)->toMatchArray(['count' => 2, 'city_ids' => []])
        ->and(alertPushBodies()[0])->toEndWith('wurde heute 2-mal gespottet.')
        ->and(alertPushBodies()[0])->not->toContain('Köln');

    // A later day spot names its own city only; the row of the day keeps the day's total.
    alertSpot($this->car, alertAt('10:00'), $this->duesseldorf);
    alertRun(alertAt('12:00'));

    $row = alertRows($this->owner)[0];
    expect(alertRows($this->owner))->toHaveCount(1)
        ->and($row->data)->toMatchArray(['count' => 3, 'city_ids' => [$this->duesseldorf->id]]);
});

it('names no city while the owner hides the car\'s cities, also for a row written before', function () {
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);
    alertRun(alertAt('12:00'));
    $this->car->forceFill(['hide_spot_cities' => true])->save();

    Sanctum::actingAs($this->owner);
    expect(collect($this->getJson('/api/v1/notifications')->json('data'))->firstWhere('type', 'spot_alert')['details'])
        ->toMatchArray(['count' => 1, 'cities_count' => 0, 'city' => null]);

    alertSpot($this->car, alertAt('13:10'), $this->koeln);
    alertRun(alertAt('15:00'));

    expect(alertRows($this->owner)[0]->data)->toMatchArray(['count' => 2, 'city_ids' => []])
        ->and(SpotAlert::query()->latest('id')->first()?->city_ids)->toBe([]);
});

it('tells only of new spots: nothing new, no change; uncounted and removed spots never count', function () {
    ntfPushOn($this->owner);
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);
    alertSpot($this->car, alertAt('09:20'), $this->duesseldorf, counted: false);
    alertSpot($this->car, alertAt('09:30'), $this->duesseldorf)->delete();

    alertRun(alertAt('12:00'));
    $first = alertRows($this->owner)[0];
    expect($first->data['count'])->toBe(1);

    // Nothing new: no row is touched, no alert is recorded.
    expect(alertRun(alertAt('15:00')))->toBe(0)
        ->and(alertRows($this->owner)[0]->created_at?->equalTo($first->created_at))->toBeTrue()
        ->and(SpotAlert::query()->count())->toBe(1);
});

it('writes one row per day and pushes only for today', function () {
    ntfPushOn($this->owner);
    alertSpot($this->car, alertAt('20:30', '2026-07-14'), $this->duesseldorf);
    alertSpot($this->car, alertAt('09:30'), $this->koeln);

    alertRun(alertAt('12:00'));

    $rows = alertRows($this->owner);
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('data.day')->all())->toBe(['2026-07-14', '2026-07-15'])
        ->and($rows->firstWhere('data.day', '2026-07-14')?->pushed_at)->toBeNull()
        ->and(alertPushBodies())->toHaveCount(1)
        ->and(alertPushBodies()[0])->toContain('Köln');
});

it('looks back 24 hours for a car never told', function () {
    alertSpot($this->car, alertAt('09:00', '2026-07-13'), $this->duesseldorf);

    expect(alertRun(alertAt('12:00')))->toBe(0)
        ->and(alertRows($this->owner))->toHaveCount(0);
});

it('pushes at most once per member and Berlin day across the gift social types; the rest stay in the list', function () {
    ntfPushOn($this->owner);
    [$second] = dexCar($this->owner);
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);
    alertSpot($second, alertAt('09:20'), $this->koeln);

    alertRun(alertAt('12:00'));

    expect(alertRows($this->owner))->toHaveCount(2)
        ->and(alertPushBodies())->toHaveCount(1)
        ->and(alertRows($this->owner)->whereNotNull('pushed_at'))->toHaveCount(1)
        ->and(app(SocialPushLimiter::class)->used($this->owner))->toBeTrue();

    // Another gift type the same day (M5.9d's badge_unlocked uses the same claim): no push either.
    $row = alertRows($this->owner)->whereNull('pushed_at')->first();
    expect(app(SocialPushLimiter::class)->claim($this->owner, $row))->toBeFalse()
        ->and(SocialPushLimiter::governs(NotificationType::SpotAlert))->toBeTrue()
        // M5.6: the weekly "Neue Treffen in deiner Nähe" push shares the same daily claim (10 §16: max 1 social push a day).
        ->and(SocialPushLimiter::governs(NotificationType::EventNearby))->toBeTrue()
        ->and(SocialPushLimiter::TYPES)->toBe(['spot_alert', 'badge_unlocked', 'car_of_the_day', 'invite_accepted', 'event_nearby']);

    // A spot later that day refreshes the row (unread again) without a push; the next day pushes again.
    alertSpot($this->car, alertAt('13:00'), $this->duesseldorf);
    alertRun(alertAt('15:00'));
    expect(alertPushBodies())->toHaveCount(1)
        ->and(alertRows($this->owner)->firstWhere('vehicle_id', $this->car->id)?->data['count'])->toBe(2);

    alertSpot($this->car, alertAt('09:00', '2026-07-16'), $this->duesseldorf);
    alertRun(alertAt('12:00', '2026-07-16'));
    expect(alertPushBodies())->toHaveCount(2);
});

it('leaves other types outside the social limit', function () {
    expect(SocialPushLimiter::governs(NotificationType::NewFollower))->toBeFalse()
        ->and(SocialPushLimiter::governs(NotificationType::Reaction))->toBeFalse();
});

it('never pushes between 22:00 and 08:00, whatever the member chose, and keeps the member\'s own quiet hours', function (string $time, array $prefs, bool $pushed) {
    ntfPushOn($this->owner);
    $this->owner->forceFill(['notification_prefs' => ['quiet_hours' => $prefs]])->save();
    alertSpot($this->car, alertAt($time)->subMinutes(30), $this->duesseldorf);

    alertRun(alertAt($time));

    expect(alertRows($this->owner))->toHaveCount(1)
        ->and(alertPushBodies())->toHaveCount($pushed ? 1 : 0)
        ->and(app(SocialPushLimiter::class)->used($this->owner, alertAt($time)))->toBe($pushed);
})->with([
    '07:30, own quiet hours off' => ['07:30', ['enabled' => false], false],
    '07:30, own quiet hours end at 07:00' => ['07:30', ['enabled' => true, 'from' => '22:00', 'to' => '07:00'], false],
    '23:00, own quiet hours off' => ['23:00', ['enabled' => false], false],
    '08:30, own quiet hours off' => ['08:30', ['enabled' => false], true],
    '12:00, own quiet hours 11:00–13:00' => ['12:00', ['enabled' => true, 'from' => '11:00', 'to' => '13:00'], false],
    '12:00, defaults' => ['12:00', [], true],
]);

it('keeps the row but sends no push while SET-09 "Spots" is off', function () {
    ntfPushOn($this->owner);
    $this->owner->forceFill(['notification_prefs' => ['types' => ['spot_alert' => ['push' => false, 'web_push' => false]]]])->save();
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);

    alertRun(alertAt('12:00'));

    expect(alertRows($this->owner))->toHaveCount(1)
        ->and(alertPushBodies())->toBe([])
        ->and(app(SocialPushLimiter::class)->used($this->owner))->toBeFalse();
});

it('never pushes about a sample car to a real member', function () {
    ntfPushOn($this->owner);
    $this->car->forceFill(['is_sample' => true])->save();
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);

    alertRun(alertAt('12:00'));

    expect(alertRows($this->owner))->toHaveCount(1)
        ->and(alertPushBodies())->toBe([]);
});

it('tells nobody who cannot use the app, and nothing about a deleted car', function () {
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);
    $this->owner->forceFill(['status' => 'suspended'])->save();
    [$gone] = dexCar();
    alertSpot($gone, alertAt('09:20'), $this->koeln);
    $gone->delete();

    expect(alertRun(alertAt('12:00')))->toBe(0)
        ->and(Notification::query()->where('type', 'spot_alert')->count())->toBe(0)
        // The suspended owner's window is still closed, so the alert does not come later all at once.
        ->and(SpotAlert::query()->where('vehicle_id', $this->car->id)->count())->toBe(1);
});

it('stops at its time budget and the next run continues with the cars left', function () {
    config(['speedclub.dex.alerts.seconds' => -1, 'speedclub.dex.alerts.chunk' => 1]);
    $cars = collect([$this->car, dexCar()[0], dexCar()[0]])->sortBy('id')->values();
    $cars->each(fn (Vehicle $car) => alertSpot($car, alertAt('09:10'), $this->duesseldorf));

    alertRun(alertAt('12:00'));
    expect(SpotAlert::query()->pluck('vehicle_id')->all())->toBe([$cars[0]->id]);

    alertRun(alertAt('12:01'));
    alertRun(alertAt('12:02'));
    expect(SpotAlert::query()->orderBy('id')->pluck('vehicle_id')->all())->toBe($cars->pluck('id')->all())
        ->and(Notification::query()->where('type', 'spot_alert')->count())->toBe(3);

    expect(alertRun(alertAt('12:03')))->toBe(0);
});

it('tells the same totals only once when a run stopped between the row and its record', function () {
    ntfPushOn($this->owner);
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);
    alertRun(alertAt('12:00'));
    // As if the run had died before it recorded the alert.
    SpotAlert::query()->delete();
    $before = alertRows($this->owner)[0];

    alertRun(alertAt('12:05'));

    expect(alertRows($this->owner))->toHaveCount(1)
        ->and(alertRows($this->owner)[0]->created_at?->equalTo($before->created_at))->toBeTrue()
        ->and(alertPushBodies())->toHaveCount(1);
});

it('does nothing while another run holds the lock', function () {
    alertSpot($this->car, alertAt('09:10'), $this->duesseldorf);
    $lock = Cache::lock(SpotAlerts::LOCK, 120);
    $lock->get();

    try {
        expect(alertRun(alertAt('12:00')))->toBeNull()
            ->and(alertRows($this->owner))->toHaveCount(0);
    } finally {
        $lock->release();
    }

    expect(alertRun(alertAt('12:01')))->toBe(1);
});

it('runs from the scheduler every three hours in Europe/Berlin', function () {
    $this->artisan('dex:spot-alerts')->assertSuccessful();

    $event = collect(app(Schedule::class)->events())
        ->first(fn ($event) => str_contains((string) $event->command, 'dex:spot-alerts'));
    expect($event?->expression)->toBe('0 */3 * * *')
        ->and($event?->timezone)->toBe('Europe/Berlin');
});

it('gives the day back when the row was not pushed after all, and prunes old claims', function () {
    $limiter = app(SocialPushLimiter::class);
    $row = app(Notifier::class)->spotAlert($this->owner, $this->car, '2026-07-15', 1, [], push: false);
    expect($row)->not->toBeNull();

    expect($limiter->claim($this->owner, $row))->toBeTrue()
        ->and($limiter->claim($this->owner, $row))->toBeFalse();
    $limiter->release($this->owner, $row);
    expect($limiter->used($this->owner))->toBeFalse();

    DB::table('social_push_claims')->insert(['user_id' => $this->owner->id, 'day' => now()->subDays(10)->toDateString(), 'type' => 'spot_alert', 'created_at' => now()]);
    expect($limiter->prune())->toBe(1);
});
