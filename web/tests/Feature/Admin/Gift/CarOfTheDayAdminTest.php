<?php

use App\Enums\Bundesland;
use App\Models\AuditEvent;
use App\Models\CarOfTheDay;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use Carbon\CarbonImmutable;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Gift/GiftTestHelpers.php';

/**
 * ADM-64 Car of the Day (M5.9d admin, m5.9d contract §3, ADR-510/513): content.view reads today, the next 14 and the last 14 days;
 * content.edit (Owner, Admin, Content editor — the Home curation's atoms, 06 §3) overrides or skips today or a later day with a reason
 * and a recent password, on the route ahead of the password check. OverrideCarOfTheDay's refusals (a past day, a car a guest may not
 * see, a sample in production) are field errors; both writes are audited by the actions.
 */
const ADM64_ROLES = ['owner', 'admin', 'content_editor'];
const ADM64_REASON = 'Treffen-Highlight des Tages, mit dem Besitzer abgesprochen.';

beforeEach(fn () => $this->travelTo(CarbonImmutable::parse('2026-07-15 12:00', 'Europe/Berlin')));

function adm64As(string $role): Staff
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);
    test()->withSession(['auth.password_confirmed_at' => time()]);

    return $staff;
}

function adm64Owner(array $attributes = []): User
{
    return giftMember(['bundesland' => Bundesland::NW, ...$attributes]);
}

// ---- authorisation matrix ---------------------------------------------------------------------------------------------------------

it('lets content.view read the page', function () {
    assertAdminMatrix('GET', '/admin/content/car-of-the-day', ADM64_ROLES, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('CarOfTheDay/Index')->where('canEdit', true)));
});

it('guards override and skip by content.edit, ahead of the password check', function (string $path, Closure $data) {
    $car = giftCar(adm64Owner(), 900);

    assertAdminMatrix('POST', "/admin/content/car-of-the-day/2026-07-16/$path", ADM64_ROLES, function (TestResponse $r): void {
        expect($r->status())->toBeIn([302, 303, 423]);
    }, $data($car));

    expect(CarOfTheDay::query()->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', 'like', 'car_of_the_day.%')->count())->toBe(0);
})->with([
    'override' => ['override', fn (Vehicle $car) => ['vehicle_id' => $car->id, 'reason' => ADM64_REASON]],
    'skip' => ['skip', fn (Vehicle $car) => ['reason' => ADM64_REASON]],
]);

// ---- the page ------------------------------------------------------------------------------------------------------------------------

it('shows today and the next 14 days, then the last 14, with car, owner, Bundesland, source, skip reason and story line', function () {
    $owner = adm64Owner(['username' => 'kai.r34']);
    $car = giftCar($owner, 900);
    $staff = adm64As('content_editor');
    CarOfTheDay::factory()->create(['day' => '2026-07-14', 'vehicle_id' => $car->id, 'bundesland' => Bundesland::NW, 'story_line' => 'Wochenend-Build aus Köln', 'source' => 'auto']);
    CarOfTheDay::factory()->create(['day' => '2026-07-17', 'vehicle_id' => null, 'skipped' => true, 'skipped_reason' => 'Wartung am Server', 'source' => 'staff', 'decided_by' => $staff->id, 'published_at' => null]);

    $props = $this->get('/admin/content/car-of-the-day')->assertOk()->inertiaProps();

    expect($props['upcoming'])->toHaveCount(15)
        ->and($props['past'])->toHaveCount(14)
        ->and($props['upcoming'][0])->toMatchArray(['day' => '2026-07-15', 'today' => true, 'editable' => true, 'vehicle' => null, 'skipped' => false])
        ->and($props['upcoming'][2])->toMatchArray(['day' => '2026-07-17', 'skipped' => true, 'skipped_reason' => 'Wartung am Server', 'source' => 'staff', 'decided_by' => $staff->name])
        ->and($props['upcoming'][14]['day'])->toBe('2026-07-29')
        // At 12:00 Home still shows the 14th, so staff may still change it (CR-P5G-03); the 13th is history.
        ->and($props['past'][0])->toMatchArray(['day' => '2026-07-14', 'editable' => true, 'story_line' => 'Wochenend-Build aus Köln', 'source' => 'auto', 'bundesland' => 'NRW'])
        ->and($props['past'][1])->toMatchArray(['day' => '2026-07-13', 'editable' => false])
        ->and($props['past'][0]['vehicle']['id'])->toBe($car->id)
        ->and($props['past'][0]['vehicle']['owner']['username'])->toBe('kai.r34')
        ->and($props['past'][13]['day'])->toBe('2026-07-01')
        ->and($props['times'])->toBe(['pick_at' => '17:55', 'publish_at' => '18:00']);
});

// ---- override ------------------------------------------------------------------------------------------------------------------------

it('chooses another car for a day, audited with the reason', function () {
    $car = giftCar(adm64Owner(), 120, photos: 1);
    adm64As('content_editor');

    $this->post('/admin/content/car-of-the-day/2026-07-16/override', ['vehicle_id' => $car->id, 'reason' => ADM64_REASON])
        ->assertStatus(303)
        ->assertSessionHas('success', 'gift.cotd.flash.overridden');

    $row = CarOfTheDay::query()->where('day', '2026-07-16')->sole();
    $event = AuditEvent::query()->where('action', 'car_of_the_day.overridden')->sole();
    expect($row->vehicle_id)->toBe($car->id)
        ->and($row->source->value)->toBe('staff')
        ->and($event->reason)->toBe(ADM64_REASON)
        ->and($event->after['vehicle_id'])->toBe($car->id);
});

it('shows the action\'s refusals as field errors and changes nothing', function (Closure $car, string $day, string $field) {
    $vehicle = $car();
    adm64As('admin');

    $this->post("/admin/content/car-of-the-day/$day/override", ['vehicle_id' => $vehicle?->id ?? '01jaaaaaaaaaaaaaaaaaaaaaaa', 'reason' => ADM64_REASON])->assertSessionHasErrors($field);

    expect(CarOfTheDay::query()->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', 'like', 'car_of_the_day.%')->count())->toBe(0);
})->with([
    // At 12:00 Home still shows the 14th (CR-P5G-03), so the 13th is the first past day.
    'a past day' => [fn () => giftCar(adm64Owner(), 900), '2026-07-13', 'day'],
    'a private car' => [fn () => giftCar(adm64Owner(), 900, attributes: ['visibility' => 'private']), '2026-07-16', 'vehicle_id'],
    'an unknown car' => [fn () => null, '2026-07-16', 'vehicle_id'],
]);

it('takes an optional reason of at most 1000 characters (ADR-540) and needs a car', function (array $data, string $field) {
    $car = giftCar(adm64Owner(), 900);
    adm64As('admin');

    $this->post('/admin/content/car-of-the-day/2026-07-16/override', [...['vehicle_id' => $car->id, 'reason' => ADM64_REASON], ...$data])->assertSessionHasErrors($field);
    $this->post('/admin/content/car-of-the-day/2026-07-16/skip', ['reason' => str_repeat('x', 1001)])->assertSessionHasErrors('reason');

    expect(CarOfTheDay::query()->count())->toBe(0);
})->with([
    'too long reason' => [['reason' => str_repeat('x', 1001)], 'reason'],
    'no car' => [['vehicle_id' => ''], 'vehicle_id'],
]);

it('has no route for a day that is no date', function () {
    adm64As('admin');

    // No write route matches; the admin's GET fallback answers the path with 405.
    expect($this->post('/admin/content/car-of-the-day/morgen/skip', ['reason' => ADM64_REASON])->status())->toBeIn([404, 405])
        ->and(CarOfTheDay::query()->count())->toBe(0);
});

// ---- skip ----------------------------------------------------------------------------------------------------------------------------

it('skips a day with its reason, audited, and refuses a past day', function () {
    adm64As('owner');

    $this->post('/admin/content/car-of-the-day/2026-07-15/skip', ['reason' => ADM64_REASON])->assertStatus(303)->assertSessionHas('success', 'gift.cotd.flash.skipped');
    $this->post('/admin/content/car-of-the-day/2026-07-10/skip', ['reason' => ADM64_REASON])->assertSessionHasErrors('day');

    $row = CarOfTheDay::query()->sole();
    expect($row->skipped)->toBeTrue()
        ->and($row->skipped_reason)->toBe(ADM64_REASON)
        ->and(AuditEvent::query()->where('action', 'car_of_the_day.skipped')->sole()->reason)->toBe(ADM64_REASON);
});
