<?php

use App\Actions\Admin\Moderation\RemoveSpots;
use App\Enums\AuditActorType;
use App\Enums\Bundesland;
use App\Enums\XpType;
use App\Http\Controllers\Admin\Spots\SpotActionsController;
use App\Models\AuditEvent;
use App\Models\DeCity;
use App\Models\DeviceInstall;
use App\Models\Spot;
use App\Models\User;
use App\Models\UserSetProgress;
use App\Models\Vehicle;
use App\Models\VehicleSpotStat;
use App\Models\XpEvent;
use App\Services\Admin\Spots\SharedDevices;
use App\Services\Audit\Audit;
use App\Services\Auth\DeviceInstalls;
use App\Services\Dex\DexSets;
use App\Services\Dex\SpotStats;
use Carbon\CarbonImmutable;
use Database\Seeders\DexSetSeeder;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Dex/DexTestHelpers.php';

/**
 * ADM-62 Spots (M5.9b admin, m5.9b contract §7): the role matrix of the list, the record and the removals; each abuse signal positive and
 * negative (burst > 10 in 10 min, shared device through device_installs.install_key (ADR-511), city hop > 300 km within 1 h by the centroid file); "Spot
 * entfernen" (reason required, audit before/after, stats and set progress recomputed by the Dex services, idempotent), the bulk run
 * (audited per spot, capped at 50, refused past 100 direct removals in 24 h) and no coordinate in any answer.
 */
const SPOT_VIEW = ['owner', 'admin', 'moderator', 'analyst'];
const SPOT_DECIDE = ['owner', 'admin', 'moderator'];

/** GeoNames ids of public/geo/de-cities.json (the centroids the hop signal reads). */
const SPOT_KOELN = 2886242;
const SPOT_DUESSELDORF = 2934246;
const SPOT_MUENCHEN = 2867714;

function spotsAs(string $role): void
{
    seedStaffRoles();
    actingAsStaff(staffWithRole($role));
    test()->withSession(['auth.password_confirmed_at' => time()]);
}

function spotCity(int $id, string $name, Bundesland $land): DeCity
{
    return DeCity::query()->find($id) ?? DeCity::factory()->named($name, $land)->create(['id' => $id]);
}

/** A spot written directly (the rules of RecordSpot are not under test here). */
function spotAt(User $spotter, CarbonImmutable $at, ?DeCity $city = null, ?Vehicle $vehicle = null): Spot
{
    return Spot::factory()->create([
        'spotter_id' => $spotter->id,
        'vehicle_id' => ($vehicle ?? Vehicle::factory()->published()->create())->id,
        'city_id' => $city?->id,
        'bundesland' => $city?->bundesland,
        'created_at' => $at,
    ]);
}

/** @return array<string, array<string, mixed>> spot id => signals, from the ADM-62 list */
function spotSignals(string $query = ''): array
{
    $rows = test()->get('/admin/moderation/spots?per_page=100'.$query)->assertOk()->inertiaProps('rows.data');

    return collect($rows)->mapWithKeys(fn (array $row): array => [$row['id'] => $row['signals']])->all();
}

/** Every key of a nested array, recursively. @return list<string> */
function spotKeys(mixed $value): array
{
    if (! is_array($value)) {
        return [];
    }
    $keys = [];
    foreach ($value as $key => $child) {
        $keys[] = (string) $key;
        array_push($keys, ...spotKeys($child));
    }

    return $keys;
}

beforeEach(function () {
    $this->t0 = CarbonImmutable::now()->subDay()->startOfHour();
});

// ---- authorisation matrix ---------------------------------------------------------------------------------------------------------

it('guards the list and the record by moderation.view', function (string $uri, string $component) {
    $spot = spotAt(dexMember(), $this->t0);
    $uri = str_replace('{spot}', $spot->id, $uri);

    assertAdminMatrix('GET', $uri, SPOT_VIEW, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component($component)));
})->with([
    'ADM-62' => ['/admin/moderation/spots', 'Spots/Index'],
    'ADM-62 filtered' => ['/admin/moderation/spots?filter[signal]=any', 'Spots/Index'],
    'ADM-62 record' => ['/admin/moderation/spots/{spot}', 'Spots/Show'],
]);

it('guards the removals by moderation.decide, ahead of the password check', function (string $path, array $data) {
    $spot = spotAt(dexMember(), $this->t0);

    assertAdminMatrix('POST', str_replace('{spot}', $spot->id, $path), SPOT_DECIDE, function (TestResponse $r): void {
        // Recent password missing: the confirm page, never a removal.
        expect($r->status())->toBeIn([302, 303, 423]);
    }, str_contains($path, 'bulk') ? [...$data, 'ids' => [$spot->id]] : $data);

    expect(Spot::query()->whereKey($spot->id)->exists())->toBeTrue()
        ->and(AuditEvent::query()->where('action', 'like', 'spot.%removed')->count())->toBe(0);
})->with([
    'remove' => ['/admin/moderation/spots/{spot}/remove', ['reason' => 'Serie von Spots in wenigen Minuten.']],
    'bulk' => ['/admin/moderation/spots/bulk-remove', ['reason' => 'Serie von Spots in wenigen Minuten.']],
]);

it('shows the analyst a read-only list and refuses a direct removal', function () {
    $spot = spotAt(dexMember(), $this->t0);
    spotsAs('analyst');

    $this->get('/admin/moderation/spots')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Spots/Index')->where('canRemove', false));
    $this->get("/admin/moderation/spots/{$spot->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('spot.can.remove', false));
    assertAdminErrorPage($this->post("/admin/moderation/spots/{$spot->id}/remove", ['reason' => 'Serie von Spots in wenigen Minuten.']), 403);
    expect(Spot::query()->whereKey($spot->id)->exists())->toBeTrue();
});

it('answers 404 for an unknown spot', function () {
    spotsAs('moderator');

    assertAdminErrorPage($this->get('/admin/moderation/spots/01JAAAAAAAAAAAAAAAAAAAAAAA'), 404);
    $this->post('/admin/moderation/spots/01JAAAAAAAAAAAAAAAAAAAAAAA/remove', ['reason' => 'Serie von Spots in wenigen Minuten.'])->assertNotFound();
});

// ---- list and filters -----------------------------------------------------------------------------------------------------------

it('lists spots newest first with spotter, car, Dex number, city, counted, night and source', function () {
    $koeln = spotCity(SPOT_KOELN, 'Köln', Bundesland::NW);
    $spotter = dexMember(['username' => 'nico.spotter']);
    [$car] = dexCar();
    $car->forceFill(['dex_number' => 4712])->save();
    $older = spotAt($spotter, $this->t0, $koeln, $car);
    $newer = spotAt(dexMember(), $this->t0->addMinutes(5));
    spotsAs('moderator');

    $this->get('/admin/moderation/spots')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Spots/Index')
        ->where('rows.data.0.id', $newer->id)
        ->where('rows.data.1.id', $older->id)
        ->where('rows.data.1.spotter.username', 'nico.spotter')
        ->where('rows.data.1.vehicle.dex_number', 4712)
        ->where('rows.data.1.city', 'Köln')
        ->where('rows.data.1.counted', true)
        ->where('rows.data.1.night', false)
        ->where('rows.data.1.source', 'scanner')
        ->where('canRemove', true)
        ->where('signals.device_available', true));
});

it('filters by spotter, car (Dex number), city, period and status', function () {
    $koeln = spotCity(SPOT_KOELN, 'Köln', Bundesland::NW);
    $nico = dexMember(['username' => 'nico.spotter']);
    [$car] = dexCar();
    $car->forceFill(['dex_number' => 4711])->save();
    $match = spotAt($nico, $this->t0, $koeln, $car);
    $other = spotAt(dexMember(['username' => 'lea.dex']), $this->t0->subDays(3));
    $removed = spotAt($nico, $this->t0->subHours(2));
    $removed->delete();
    spotsAs('moderator');

    $ids = fn (string $query): array => collect($this->get('/admin/moderation/spots?'.$query)->assertOk()->inertiaProps('rows.data'))->pluck('id')->all();

    expect($ids('filter[spotter]=@nico'))->toBe([$match->id])
        ->and($ids('filter[car]=%23'.$car->dex_number))->toBe([$match->id])
        ->and($ids('filter[city]=Kö'))->toBe([$match->id])
        ->and($ids('filter[from]='.$this->t0->subDays(4)->setTimezone('Europe/Berlin')->format('Y-m-d').'&filter[to]='.$this->t0->subDays(2)->setTimezone('Europe/Berlin')->format('Y-m-d')))->toBe([$other->id])
        ->and($ids('filter[status]=removed'))->toBe([$removed->id])
        ->and($ids('filter[status]=all'))->toHaveCount(3)
        ->and($ids(''))->not->toContain($removed->id);
});

// ---- signals ----------------------------------------------------------------------------------------------------------------------

it('flags a burst: more than 10 spots by one spotter inside 10 minutes', function () {
    $fast = dexMember();
    $burst = collect(range(0, 10))->map(fn (int $i) => spotAt($fast, $this->t0->addSeconds($i * 50)));
    spotsAs('moderator');

    $signals = spotSignals();
    foreach ($burst as $spot) {
        expect($signals[$spot->id]['burst'])->toBe(['spots' => 11]);
    }
    expect(collect($this->get('/admin/moderation/spots?filter[signal]=burst&per_page=100')->inertiaProps('rows.data'))->pluck('id')->sort()->values()->all())
        ->toBe($burst->pluck('id')->sort()->values()->all());
});

it('does not flag ten spots in ten minutes, nor eleven spread over twenty', function () {
    $ten = dexMember();
    $slow = dexMember();
    $spots = collect(range(0, 9))->map(fn (int $i) => spotAt($ten, $this->t0->addSeconds($i * 60)))
        ->merge(collect(range(0, 10))->map(fn (int $i) => spotAt($slow, $this->t0->addMinutes($i * 2))));
    spotsAs('moderator');

    $signals = spotSignals();
    foreach ($spots as $spot) {
        expect($signals[$spot->id]['burst'])->toBeNull();
    }
    expect($this->get('/admin/moderation/spots?filter[signal]=any')->inertiaProps('rows.data'))->toBe([]);
});

it('flags an impossible city hop: two cities more than 300 km apart within one hour', function () {
    $koeln = spotCity(SPOT_KOELN, 'Köln', Bundesland::NW);
    $muenchen = spotCity(SPOT_MUENCHEN, 'München', Bundesland::BY);
    $hopper = dexMember();
    $a = spotAt($hopper, $this->t0, $koeln);
    $b = spotAt($hopper, $this->t0->addMinutes(40), $muenchen);
    spotsAs('moderator');

    $signals = spotSignals();
    expect($signals[$a->id]['hop'])->toMatchArray(['city' => 'München', 'minutes' => 40])
        ->and($signals[$a->id]['hop']['km'])->toBeGreaterThan(400)->toBeLessThan(500)
        ->and($signals[$b->id]['hop']['city'])->toBe('Köln')
        ->and(collect($this->get('/admin/moderation/spots?filter[signal]=hop')->inertiaProps('rows.data'))->pluck('id')->sort()->values()->all())
        ->toBe(collect([$a->id, $b->id])->sort()->values()->all());
});

it('does not flag nearby cities within the hour or far cities two hours apart', function () {
    $koeln = spotCity(SPOT_KOELN, 'Köln', Bundesland::NW);
    $duesseldorf = spotCity(SPOT_DUESSELDORF, 'Düsseldorf', Bundesland::NW);
    $muenchen = spotCity(SPOT_MUENCHEN, 'München', Bundesland::BY);
    $near = dexMember();
    $slow = dexMember();
    $spots = [
        spotAt($near, $this->t0, $koeln), spotAt($near, $this->t0->addMinutes(20), $duesseldorf),
        spotAt($slow, $this->t0, $koeln), spotAt($slow, $this->t0->addMinutes(120), $muenchen),
    ];
    spotsAs('moderator');

    $signals = spotSignals();
    foreach ($spots as $spot) {
        expect($signals[$spot->id]['hop'])->toBeNull();
    }
    expect($this->get('/admin/moderation/spots?filter[signal]=hop')->inertiaProps('rows.data'))->toBe([]);
});

it('flags a shared device only where an install is shared by spotting accounts, never with the key', function () {
    $first = dexMember();
    $second = dexMember();
    $alone = dexMember();
    $a = spotAt($first, $this->t0);
    $b = spotAt($second, $this->t0->addHour());
    $c = spotAt($alone, $this->t0->addHours(2));

    // ADR-511: each member's row of one install carries the same member-free key; the per-member hash differs as before (ADR-435).
    $shared = DeviceInstalls::installKey('install-shared-62');
    DeviceInstall::factory()->for($first)->create(['install_key' => $shared]);
    DeviceInstall::factory()->for($second)->create(['install_key' => $shared]);
    DeviceInstall::factory()->for($alone)->create(['install_key' => DeviceInstalls::installKey('install-alone-62')]);
    // A non-spotting account on the shared install is not an "other spotting account".
    DeviceInstall::factory()->create(['install_key' => $shared]);

    spotsAs('moderator');
    $signals = spotSignals();
    expect($this->get('/admin/moderation/spots')->inertiaProps('signals.device_available'))->toBeTrue()
        ->and($signals[$a->id]['device'])->toBe(['accounts' => 1])
        ->and($signals[$b->id]['device'])->toBe(['accounts' => 1])
        ->and($signals[$c->id]['device'])->toBeNull()
        ->and(collect($this->get('/admin/moderation/spots?filter[signal]=device')->inertiaProps('rows.data'))->pluck('id')->sort()->values()->all())
        ->toBe(collect([$a->id, $b->id])->sort()->values()->all());

    // The key itself never reaches a page: not in the list, not on the record.
    $pages = json_encode([
        $this->get('/admin/moderation/spots?per_page=100')->inertiaProps(),
        $this->get("/admin/moderation/spots/{$a->id}")->assertOk()->inertiaProps(),
    ], JSON_THROW_ON_ERROR);
    expect($pages)->not->toContain($shared);
});

it('reads no shared install from rows without the member-free key (installs from before ADR-511)', function () {
    $first = dexMember();
    $second = dexMember();
    spotAt($first, $this->t0);
    spotAt($second, $this->t0->addHour());
    DeviceInstall::factory()->for($first)->create(['install_key' => null]);
    DeviceInstall::factory()->for($second)->create(['install_key' => null]);

    expect(app(SharedDevices::class)->spotters())->toBe([]);
});

// ---- removal ----------------------------------------------------------------------------------------------------------------------

it('takes an optional reason of at most 1000 characters (ADR-540)', function (array $data) {
    $spot = spotAt(dexMember(), $this->t0);
    spotsAs('moderator');

    $this->post("/admin/moderation/spots/{$spot->id}/remove", $data)->assertSessionHasErrors('reason');
    expect(Spot::query()->whereKey($spot->id)->exists())->toBeTrue()
        ->and(AuditEvent::query()->where('action', RemoveSpots::EVENT)->count())->toBe(0);
})->with([
    'too long' => [['reason' => str_repeat('a', 1001)]],
]);

it('removes a spot: soft delete, audit with before/after, stats and set progress recomputed, idempotent', function () {
    $this->seed(DexSetSeeder::class);
    $koeln = spotCity(SPOT_KOELN, 'Köln', Bundesland::NW);
    [$car, $code] = dexCar();
    $spotter = dexMember();
    $other = dexMember();
    dexSpot($spotter, $code, ['city_id' => $koeln->id])->assertCreated();
    dexSpot($other, $code, ['city_id' => $koeln->id])->assertCreated();
    $spot = Spot::query()->where('spotter_id', $spotter->id)->sole();
    $brand = UserSetProgress::query()->where('user_id', $spotter->id)->where('set_key', 'like', 'brand-%')->sole();
    expect($brand->progress)->toBe(1)->and(VehicleSpotStat::query()->find($car->id)?->total)->toBe(2);

    spotsAs('moderator');
    $reason = 'Spot über ein Zweitkonto des Besitzers.';
    $this->post("/admin/moderation/spots/{$spot->id}/remove", ['reason' => $reason])->assertRedirect()->assertSessionHas('success', 'spots.flash.removed');

    $stat = VehicleSpotStat::query()->find($car->id);
    $event = AuditEvent::query()->where('action', RemoveSpots::EVENT)->sole();
    expect(Spot::withTrashed()->find($spot->id)?->trashed())->toBeTrue()
        ->and($stat?->total)->toBe(1)
        ->and($stat?->unique_spotters)->toBe(1)
        ->and(UserSetProgress::query()->where('user_id', $spotter->id)->where('set_key', $brand->set_key)->value('progress'))->toBe(0)
        ->and($event->reason)->toBe($reason)
        ->and($event->target_type)->toBe('spot')
        ->and($event->target_id)->toBe($spot->id)
        ->and($event->getRawOriginal('actor_type'))->toBe(AuditActorType::Staff->value)
        ->and($event->before)->toMatchArray(['vehicle_id' => $car->id, 'spotter_id' => $spotter->id, 'city' => 'Köln', 'deleted_at' => null])
        ->and($event->after['vehicle_stats'] ?? null)->toMatchArray(['total' => 1, 'unique_spotters' => 1]);

    // The spotter's Dex no longer holds the car.
    Sanctum::actingAs($spotter);
    $this->getJson('/api/v1/me/dex')->assertOk()->assertJsonPath('meta.found', 0);

    // Again: nothing changes, nothing is recorded.
    spotsAs('moderator');
    $this->post("/admin/moderation/spots/{$spot->id}/remove", ['reason' => $reason])->assertSessionHas('success', 'spots.flash.already');
    expect(AuditEvent::query()->where('action', RemoveSpots::EVENT)->count())->toBe(1);

    // The record shows who removed it; the reason only to staff who may read the audit log; no remove action any more.
    $this->get("/admin/moderation/spots/{$spot->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('spot.removal.reason', null)
        ->where('spot.removal.by', fn (?string $name) => $name !== null));
    spotsAs('owner');
    $this->get("/admin/moderation/spots/{$spot->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Spots/Show')
        ->where('spot.removed_at', fn (?string $at) => $at !== null)
        ->where('spot.removal.reason', $reason)
        ->where('spot.can.remove', false)
        ->where('spot.removals.0.id', $spot->id));
});

it('takes back a set completion and its XP when the removed spots made it, never otherwise (SEC-P5G-05)', function (bool $bulk) {
    config(['speedclub.dex.sets.city_target' => 2]);
    $this->seed(DexSetSeeder::class);
    $koeln = spotCity(SPOT_KOELN, 'Köln', Bundesland::NW);
    $spotter = dexMember();
    [$first, $firstCode] = dexCar();
    [, $secondCode] = dexCar();
    [, $thirdCode] = dexCar();
    dexSpot($spotter, $firstCode, ['city_id' => $koeln->id])->assertCreated();
    dexSpot($spotter, $secondCode, ['city_id' => $koeln->id])->assertCreated();
    dexSpot($spotter, $thirdCode)->assertCreated(); // no city: not part of the city set
    $set = fn () => UserSetProgress::query()->where('user_id', $spotter->id)->where('set_key', 'stadtkenner')->first();
    $setXp = fn () => XpEvent::query()->where('user_id', $spotter->id)->where('type', XpType::SetCompleted->value)->where('ref_id', 'stadtkenner')->count();
    expect($set()?->completed_at)->not->toBeNull()->and($setXp())->toBe(1);
    $xpBefore = (int) $spotter->refresh()->xp;

    spotsAs('moderator');
    $reason = 'Spots über Zweitkonten ohne Anwesenheit.';
    // A spot the completed set does not rest on changes nothing about it.
    $other = Spot::query()->where('spotter_id', $spotter->id)->whereNull('city_id')->sole();
    $this->post("/admin/moderation/spots/{$other->id}/remove", ['reason' => $reason])->assertSessionHas('success', 'spots.flash.removed');
    expect($set()?->completed_at)->not->toBeNull()->and(AuditEvent::query()->where('action', 'dex.set_revoked')->count())->toBe(0);

    $abuse = Spot::query()->where('spotter_id', $spotter->id)->where('vehicle_id', $first->id)->sole();
    $bulk
        ? $this->post('/admin/moderation/spots/bulk-remove', ['ids' => [$abuse->id], 'reason' => $reason])->assertSessionHas('success', 'spots.flash.bulk_done')
        : $this->post("/admin/moderation/spots/{$abuse->id}/remove", ['reason' => $reason])->assertSessionHas('success', 'spots.flash.removed');

    $event = AuditEvent::query()->where('action', 'dex.set_revoked')->sole();
    expect($set()?->completed_at)->toBeNull()
        ->and($set()?->progress)->toBe(1)
        ->and($setXp())->toBe(0)
        ->and((int) $spotter->refresh()->xp)->toBeLessThanOrEqual($xpBefore - 100)
        ->and($event->before)->toBe(['completed' => ['stadtkenner']])
        ->and($event->reason)->toBe($reason)
        ->and($event->getRawOriginal('actor_type'))->toBe(AuditActorType::Staff->value);
})->with(['one' => false, 'bulk' => true]);

it('keeps a completed set when a car of it merely went private (no abuse)', function () {
    config(['speedclub.dex.sets.city_target' => 2]);
    $this->seed(DexSetSeeder::class);
    $koeln = spotCity(SPOT_KOELN, 'Köln', Bundesland::NW);
    $spotter = dexMember();
    [$first, $firstCode] = dexCar();
    [, $secondCode] = dexCar();
    dexSpot($spotter, $firstCode, ['city_id' => $koeln->id])->assertCreated();
    dexSpot($spotter, $secondCode, ['city_id' => $koeln->id])->assertCreated();

    $first->forceFill(['visibility' => 'private'])->save();
    app(DexSets::class)->repair($spotter);

    expect(UserSetProgress::query()->where('user_id', $spotter->id)->where('set_key', 'stadtkenner')->value('completed_at'))->not->toBeNull();
});

it('audits the first record view of a day per staff member', function () {
    $spot = spotAt(dexMember(), $this->t0);
    spotsAs('moderator');

    $this->get("/admin/moderation/spots/{$spot->id}")->assertOk();
    $this->get("/admin/moderation/spots/{$spot->id}")->assertOk();

    expect(AuditEvent::query()->where('action', 'spot.viewed')->where('target_id', $spot->id)->count())->toBe(1);
});

it('removes a burst in bulk: each spot audited, stats recomputed once, already removed spots are fine', function () {
    [$car] = dexCar();
    $fast = dexMember();
    $burst = collect(range(0, 11))->map(fn (int $i) => spotAt($fast, $this->t0->addSeconds($i * 30), null, $car));
    app(SpotStats::class)->recompute($car->id);
    $burst->first()?->delete();
    spotsAs('moderator');

    $this->post('/admin/moderation/spots/bulk-remove', ['ids' => $burst->pluck('id')->all(), 'reason' => 'Serie: zwölf Spots in sechs Minuten.'])
        ->assertRedirect()->assertSessionHas('success', 'spots.flash.bulk_done')
        ->assertSessionHas(SpotActionsController::FLASH, fn (array $flash): bool => count($flash['rows']) === 12
            && collect($flash['rows'])->every(fn (array $row): bool => $row['ok'])
            && collect($flash['rows'])->where('code', 'already_removed')->count() === 1);

    expect(Spot::query()->where('spotter_id', $fast->id)->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', RemoveSpots::EVENT)->count())->toBe(11)
        ->and(AuditEvent::query()->where('action', RemoveSpots::BULK_EVENT)->sole()->after)->toMatchArray(['records' => 11, 'requested' => 12])
        ->and(VehicleSpotStat::query()->find($car->id)?->total)->toBe(0);
});

it('caps a bulk run at 50 spots and refuses past 100 direct removals in 24 hours', function () {
    $fast = dexMember();
    $spots = collect(range(0, 50))->map(fn (int $i) => spotAt($fast, $this->t0->addSeconds($i * 5)));
    spotsAs('moderator');

    $this->post('/admin/moderation/spots/bulk-remove', ['ids' => $spots->pluck('id')->all(), 'reason' => 'Serie: viele Spots in wenigen Minuten.'])->assertSessionHasErrors('ids');
    expect(Spot::query()->where('spotter_id', $fast->id)->count())->toBe(51);

    // 95 removed directly in the last 24 hours (the summary events count): ten more would pass 100.
    Audit::record(RemoveSpots::BULK_EVENT, null, null, ['records' => 95], 'Frühere Serie', auth('staff')->user());
    $this->post('/admin/moderation/spots/bulk-remove', ['ids' => $spots->take(10)->pluck('id')->all(), 'reason' => 'Serie: viele Spots in wenigen Minuten.'])
        ->assertSessionHasErrors(['ids' => 'spots.bulk.window']);
    expect(Spot::query()->where('spotter_id', $fast->id)->count())->toBe(51);

    $this->post('/admin/moderation/spots/bulk-remove', ['ids' => $spots->take(5)->pluck('id')->all(), 'reason' => 'Serie: viele Spots in wenigen Minuten.'])->assertSessionHas('success', 'spots.flash.bulk_done');
    expect(Spot::query()->where('spotter_id', $fast->id)->count())->toBe(46);
});

// ---- privacy ----------------------------------------------------------------------------------------------------------------------

it('sends no coordinate in any ADM-62 answer', function () {
    $koeln = spotCity(SPOT_KOELN, 'Köln', Bundesland::NW);
    $muenchen = spotCity(SPOT_MUENCHEN, 'München', Bundesland::BY);
    $hopper = dexMember();
    $spot = spotAt($hopper, $this->t0, $koeln);
    spotAt($hopper, $this->t0->addMinutes(30), $muenchen);
    spotsAs('moderator');

    $answers = [
        $this->get('/admin/moderation/spots')->inertiaProps(),
        $this->get('/admin/moderation/spots?filter[signal]=hop')->inertiaProps(),
        $this->get("/admin/moderation/spots/{$spot->id}")->inertiaProps(),
        $this->postJson("/admin/moderation/spots/{$spot->id}/remove", ['reason' => 'Städtesprung Köln nach München.'])->assertOk()->json(),
    ];

    foreach ($answers as $answer) {
        $keys = spotKeys($answer);
        expect(array_intersect($keys, ['lat', 'lng', 'lon', 'latitude', 'longitude', 'coordinates', 'location', 'geo', 'install_key', 'install_id_hash']))->toBe([]);
        expect(json_encode($answer, JSON_THROW_ON_ERROR))->not->toContain('50.933')->not->toContain('48.137');
    }
});
