<?php

use App\Actions\Admin\CarOfTheDay\OverrideCarOfTheDay;
use App\Actions\Admin\CarOfTheDay\SkipCarOfTheDay;
use App\Enums\Bundesland;
use App\Enums\KeywordList;
use App\Enums\NotificationType;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Models\AuditEvent;
use App\Models\CarOfTheDay;
use App\Models\FeatureFlag;
use App\Models\KeywordRule;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use App\Services\CarOfTheDay\CarOfTheDayPicker;
use App\Services\CarOfTheDay\CarOfTheDayRunner;
use App\Services\CarOfTheDay\CarOfTheDays;
use App\Services\Moderation\ContentRemoval;
use App\Services\Notifications\SocialPushLimiter;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use App\Services\Search\VehicleSearchProjector;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GiftTestHelpers.php';
require_once __DIR__.'/../Admin/Support/helpers.php';
require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M5.9d Car of the Day (m5.9d contract §3, §9, §10.3, ADR-510): every rule of the 17:55 pick, the 18:00 publication with the owner's
 * notification and the opt-in push, Home's lead module from 18:00 to 18:00, the owner's story line (authorisation matrix, keyword
 * rules, 409 outside the day) and the staff override/skip (atom, audit).
 */
function cotdAt(string $time, string $day = '2026-07-15'): CarbonImmutable
{
    return CarbonImmutable::parse("$day $time", 'Europe/Berlin');
}

function cotdRun(string $time, string $day = '2026-07-15'): ?array
{
    test()->travelTo(cotdAt($time, $day));

    return app(CarOfTheDayRunner::class)->run();
}

function cotdSamples(bool $on): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'editorial_samples'], ['enabled' => $on, 'description' => 'editorial_samples']);
}

function cotdOwner(Bundesland $land = Bundesland::NW, array $attributes = []): User
{
    return giftMember(['bundesland' => $land, ...$attributes]);
}

function cotdPush(User $member, string $token): void
{
    PushToken::factory()->create(['user_id' => $member->id, 'token' => "ExponentPushToken[$token]", 'device_id' => 'install-'.$token]);
}

beforeEach(fn () => $this->travelTo(cotdAt('12:00')));

describe('the pick', function () {
    it('takes only public cars with a score of 400 and 4 usable photos, not featured in the last 180 days', function () {
        $good = giftCar(cotdOwner(), 450);
        giftCar(cotdOwner(), 399);
        giftCar(cotdOwner(), 900, photos: 3);
        giftCar(cotdOwner(), 900, attributes: ['visibility' => 'private']);
        giftCar(cotdOwner(), 900, attributes: ['visibility' => 'unlisted']);
        giftCar(cotdOwner(), 900, attributes: ['ghost_mode' => true]);
        $recent = giftCar(cotdOwner(), 990);
        CarOfTheDay::factory()->create(['day' => '2026-03-01', 'vehicle_id' => $recent->id]);

        expect(app(CarOfTheDayPicker::class)->choose('2026-07-15')['vehicle_id'])->toBe($good->id);

        // 180 days later the earlier pick may come back, and its higher score wins.
        expect(app(CarOfTheDayPicker::class)->choose('2026-08-29')['vehicle_id'])->toBe($recent->id);
    });

    it('skips a suspended owner\'s car and a car whose owner is unverified', function () {
        giftCar(User::factory()->suspended()->create(['bundesland' => 'NW']), 900);
        giftCar(User::factory()->unverified()->create(['bundesland' => 'NW']), 900);

        expect(app(CarOfTheDayPicker::class)->choose('2026-07-15'))->toBeNull();
    });

    it('rotates the Bundesland: the one picked longest ago (or never) first, any when none has a candidate', function () {
        $nw = giftCar(cotdOwner(Bundesland::NW), 900);
        $by = giftCar(cotdOwner(Bundesland::BY), 500);
        CarOfTheDay::factory()->create(['day' => '2026-07-14', 'vehicle_id' => giftCar(cotdOwner(Bundesland::BY), 400)->id, 'bundesland' => 'BY']);
        CarOfTheDay::factory()->create(['day' => '2026-07-10', 'vehicle_id' => giftCar(cotdOwner(Bundesland::NW), 400)->id, 'bundesland' => 'NW']);
        foreach (Bundesland::cases() as $i => $land) {
            if (! in_array($land, [Bundesland::NW, Bundesland::BY], true)) {
                CarOfTheDay::factory()->create(['day' => '2026-06-'.str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT), 'vehicle_id' => null, 'bundesland' => $land->value, 'skipped' => false]);
            }
        }

        // Every other Bundesland was used in June but has no candidate; NW (10 July) waited longer than BY (14 July).
        expect(app(CarOfTheDayPicker::class)->rotation()[14])->toBe('NW')
            ->and(app(CarOfTheDayPicker::class)->choose('2026-07-15')['vehicle_id'])->toBe($nw->id);

        // NW picked yesterday: now BY waited longest.
        CarOfTheDay::query()->where('bundesland', 'BY')->where('day', '2026-07-14')->update(['day' => '2026-07-09']);
        CarOfTheDay::query()->where('bundesland', 'NW')->update(['day' => '2026-07-14']);
        expect(app(CarOfTheDayPicker::class)->choose('2026-07-15')['vehicle_id'])->toBe($by->id);
    });

    it('falls back to a car without a Bundesland', function () {
        $car = giftCar(cotdOwner(attributes: ['bundesland' => null]), 500);

        expect(app(CarOfTheDayPicker::class)->choose('2026-07-15'))->toBe(['vehicle_id' => $car->id, 'bundesland' => null, 'sample' => false]);
    });

    it('never picks a sample in production, even when it is the only candidate', function () {
        cotdSamples(true);
        giftCar(cotdOwner(attributes: ['is_sample' => true]), 900, attributes: ['is_sample' => true]);
        $this->app->detectEnvironment(fn (): string => 'production');

        expect(app(CarOfTheDayPicker::class)->choose('2026-07-15'))->toBeNull();
    });

    it('takes a sample elsewhere only when no real car qualifies, and marks it', function () {
        cotdSamples(true);
        $sample = giftCar(cotdOwner(attributes: ['is_sample' => true]), 990, attributes: ['is_sample' => true]);

        expect(app(CarOfTheDayPicker::class)->choose('2026-07-15'))->toMatchArray(['vehicle_id' => $sample->id, 'sample' => true]);

        $real = giftCar(cotdOwner(), 400);
        expect(app(CarOfTheDayPicker::class)->choose('2026-07-15'))->toMatchArray(['vehicle_id' => $real->id, 'sample' => false]);
    });

    it('is never random: the same data picks the same car', function () {
        foreach (range(1, 4) as $i) {
            giftCar(cotdOwner(), 600);
        }

        $first = app(CarOfTheDayPicker::class)->choose('2026-07-15');

        expect(collect(range(1, 5))->map(fn () => app(CarOfTheDayPicker::class)->choose('2026-07-15'))->unique()->all())->toBe([$first]);
    });
});

describe('the day', function () {
    it('picks at 17:55, publishes at 18:00 and tells the owner and the members who opted in, once', function () {
        ntfPushOn();
        $owner = cotdOwner(attributes: ['locale' => 'de']);
        cotdPush($owner, 'owner00000000000000000');
        $car = giftCar($owner, 600, attributes: ['description' => 'Mein R34 hat 20 Jahre Garage hinter sich. Jetzt wird er gefahren.']);
        $fan = giftMember(['notification_prefs' => ['types' => ['car_of_the_day' => ['push' => true]]]]);
        cotdPush($fan, 'fan000000000000000000');
        $quiet = giftMember();
        cotdPush($quiet, 'quiet0000000000000000');
        $blocked = giftMember(['notification_prefs' => ['types' => ['car_of_the_day' => ['push' => true]]]]);
        cotdPush($blocked, 'blocked00000000000000');
        giftBlock($owner, $blocked);

        expect(cotdRun('17:50'))->toMatchArray(['picked' => false])
            ->and(CarOfTheDay::query()->count())->toBe(0);

        expect(cotdRun('17:55'))->toMatchArray(['picked' => true, 'published' => false]);
        $pick = CarOfTheDay::query()->firstOrFail();
        expect($pick->vehicle_id)->toBe($car->id)->and($pick->published_at)->toBeNull()
            ->and($pick->story_line)->toBe('Mein R34 hat 20 Jahre Garage hinter sich.');

        expect(cotdRun('18:00'))->toMatchArray(['published' => true, 'told' => true]);
        cotdRun('18:05');

        $types = fn (User $user): array => Notification::query()->where('notifiable_id', $user->id)->pluck('type')->map->value->all();

        expect($types($owner))->toBe([NotificationType::CarOfTheDayOwner->value])
            ->and($types($fan))->toBe([NotificationType::CarOfTheDay->value])
            ->and($types($quiet))->toBe([])
            ->and($types($blocked))->toBe([])
            ->and(ntfPushes())->toHaveCount(2)
            ->and(CarOfTheDay::query()->firstOrFail()->notified_at)->not->toBeNull();
    });

    it('counts the opt-in push against the one social push of the day; the owner\'s own push is not limited', function () {
        ntfPushOn();
        $owner = cotdOwner();
        cotdPush($owner, 'owner00000000000000000');
        giftCar($owner, 600);
        $fan = giftMember(['notification_prefs' => ['types' => ['car_of_the_day' => ['push' => true]]]]);
        cotdPush($fan, 'fan000000000000000000');
        $this->travelTo(cotdAt('09:00'));
        app(SocialPushLimiter::class)->claim($fan, Notification::factory()->create(['notifiable_id' => $fan->id, 'type' => NotificationType::SpotAlert]));
        app(SocialPushLimiter::class)->claim($owner, Notification::factory()->create(['notifiable_id' => $owner->id, 'type' => NotificationType::SpotAlert]));

        cotdRun('17:55');
        cotdRun('18:00');

        expect(Notification::query()->where('notifiable_id', $fan->id)->where('type', 'car_of_the_day')->value('pushed_at'))->toBeNull()
            ->and(Notification::query()->where('notifiable_id', $owner->id)->where('type', 'car_of_the_day_owner')->value('pushed_at'))->not->toBeNull();
    });

    it('withdraws a pick whose car became unlistable between pick and publish, tells nobody and leaves the day empty (SEC-P5G-02)', function (Closure $change) {
        ntfPushOn();
        $owner = cotdOwner();
        cotdPush($owner, 'owner00000000000000000');
        $car = giftCar($owner, 600);
        giftCar(cotdOwner(), 500);
        $fan = giftMember(['notification_prefs' => ['types' => ['car_of_the_day' => ['push' => true]]]]);
        cotdPush($fan, 'fan000000000000000000');

        cotdRun('17:55');
        expect(CarOfTheDay::query()->firstOrFail()->vehicle_id)->toBe($car->id);
        $change($car);

        cotdRun('18:00');
        cotdRun('18:05');
        $row = CarOfTheDay::query()->firstOrFail();

        expect($row->skipped)->toBeTrue()
            ->and($row->skipped_reason)->toBe(CarOfTheDays::WITHDRAWN)
            ->and($row->published_at)->toBeNull()
            ->and(Notification::query()->count())->toBe(0)
            ->and(ntfPushes())->toBe([])
            ->and($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day'))->toBeNull()
            ->and(AuditEvent::query()->where('action', 'car_of_the_day.withdrawn')->count())->toBe(1);
    })->with([
        'ghost mode' => [function ($car) {
            $car->forceFill(['ghost_mode' => true])->save();
        }],
        'private' => [function ($car) {
            $car->forceFill(['visibility' => 'private'])->save();
        }],
        'hidden by moderation' => [function ($car) {
            $case = ModerationCase::factory()->create([
                'target_type' => ReportTargetType::Vehicle,
                'target_id' => $car->id,
                'subject_id' => $car->owner_id,
                'open_target' => ModerationCase::openKey(ReportTargetType::Vehicle, $car->id),
            ]);
            app(ContentRemoval::class)->remove($case);
        }],
        'owner suspended' => [function ($car) {
            $car->owner->forceFill(['status' => 'suspended'])->save();
        }],
    ]);

    it('stops a fan-out that resumes over several runs once the owner switches on Ghost mode, and takes back what was written', function () {
        config(['speedclub.car_of_the_day.fanout_chunk' => 1, 'speedclub.car_of_the_day.seconds' => 0]);
        $owner = cotdOwner();
        $car = giftCar($owner, 600);
        $fans = collect(range(1, 3))->map(function (int $i) {
            $fan = giftMember(['notification_prefs' => ['types' => ['car_of_the_day' => ['push' => true]]]]);
            cotdPush($fan, 'fan'.$i.str_repeat('0', 18));

            return $fan;
        });

        cotdRun('17:55');
        expect(cotdRun('18:00'))->toMatchArray(['published' => true, 'told' => false]);
        expect(Notification::query()->where('type', 'car_of_the_day')->count())->toBe(1);

        $car->forceFill(['ghost_mode' => true])->save();
        cotdRun('18:05');

        expect(CarOfTheDay::query()->firstOrFail()->skipped)->toBeTrue()
            ->and(Notification::query()->whereIn('type', ['car_of_the_day', 'car_of_the_day_owner'])->count())->toBe(0)
            ->and($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day'))->toBeNull()
            ->and($fans)->toHaveCount(3);
    });

    it('tells nobody about a sample pick', function () {
        cotdSamples(true);
        $owner = cotdOwner(attributes: ['is_sample' => true]);
        giftCar($owner, 600, attributes: ['is_sample' => true]);
        $fan = giftMember(['notification_prefs' => ['types' => ['car_of_the_day' => ['push' => true]]]]);
        cotdPush($fan, 'fan000000000000000000');

        cotdRun('17:55');
        cotdRun('18:00');

        expect(CarOfTheDay::query()->firstOrFail()->is_sample)->toBeTrue()
            ->and(Notification::query()->count())->toBe(0);
    });
});

describe('Home', function () {
    it('leads Home from 18:00 to the next 18:00 with day, story, card, owner and is_sample', function () {
        $owner = cotdOwner(attributes: ['username' => 'nightr34']);
        $car = giftCar($owner, 600);
        cotdRun('17:55');

        $this->travelTo(cotdAt('17:59'));
        expect($this->getJson('/api/v1/home/modules')->assertOk()->json('data.car_of_the_day'))->toBeNull();

        cotdRun('18:00');
        $module = $this->getJson('/api/v1/home/modules')->assertOk()->json('data.car_of_the_day');

        expect($module)->toMatchArray(['day' => '2026-07-15', 'is_sample' => false])
            ->and($module['vehicle']['id'])->toBe($car->id)
            ->and($module['owner']['username'])->toBe('nightr34')
            ->and(array_key_exists('story_line', $module))->toBeTrue();

        $this->travelTo(cotdAt('17:59', '2026-07-16'));
        expect($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day.day'))->toBe('2026-07-15');

        $this->travelTo(cotdAt('18:00', '2026-07-16'));
        expect($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day'))->toBeNull();
    });

    it('hides it from a member the owner blocked and once the car went private', function () {
        $owner = cotdOwner();
        $car = giftCar($owner, 600);
        cotdRun('17:55');
        cotdRun('18:00');
        $blocked = giftMember();
        giftBlock($owner, $blocked);

        Sanctum::actingAs($blocked);
        expect($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day'))->toBeNull();

        $car->forceFill(['visibility' => 'private'])->save();
        app(VehicleSearchProjector::class)->rebuild($car->id);
        Sanctum::actingAs(giftMember());
        expect($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day'))->toBeNull();
    });
});

describe('PATCH vehicles/{id}/car-of-the-day', function () {
    beforeEach(function () {
        $this->owner = cotdOwner();
        $this->car = giftCar($this->owner, 600);
        cotdRun('17:55');
        cotdRun('18:00');
        $this->travelTo(cotdAt('20:00'));
    });

    it('saves the owner\'s line, whitespace collapsed; empty removes it', function () {
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->car->id}/car-of-the-day", ['story_line' => "  20 Jahre   in der Garage,\njetzt auf der Straße.  "])
            ->assertOk()->assertExactJson(['data' => ['story_line' => '20 Jahre in der Garage, jetzt auf der Straße.']]);
        expect(CarOfTheDay::query()->firstOrFail()->story_line)->toBe('20 Jahre in der Garage, jetzt auf der Straße.')
            ->and($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day.story_line'))->toBe('20 Jahre in der Garage, jetzt auf der Straße.');

        $this->patchJson("/api/v1/vehicles/{$this->car->id}/car-of-the-day", ['story_line' => ''])->assertOk()->assertExactJson(['data' => ['story_line' => null]]);
    });

    it('validates the line: at most 140 characters, present', function (array $body) {
        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/vehicles/{$this->car->id}/car-of-the-day", $body)->assertUnprocessable()->assertJsonValidationErrors(['story_line']);
    })->with([[['story_line' => str_repeat('a', 141)]], [[]], [['story_line' => ['x']]]]);

    it('refuses a blocked keyword on story_line', function () {
        $rule = new KeywordRule;
        $rule->forceFill(['term' => 'verbotenwort', 'normalized' => KeywordNormaliser::term('verbotenwort'), 'list' => KeywordList::Block])->save();
        app(KeywordRules::class)->flush();
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->car->id}/car-of-the-day", ['story_line' => 'Ein verbotenwort hier'])
            ->assertUnprocessable()->assertJsonPath('code', 'content_blocked')->assertJsonValidationErrors(['story_line']);
    });

    it('answers 409 outside the car\'s day', function () {
        Sanctum::actingAs($this->owner);
        $this->travelTo(cotdAt('18:01', '2026-07-16'));

        $this->patchJson("/api/v1/vehicles/{$this->car->id}/car-of-the-day", ['story_line' => 'Zu spät'])->assertStatus(409)->assertJsonPath('code', 'not_car_of_the_day');
        $other = giftCar($this->owner, 600);
        $this->patchJson("/api/v1/vehicles/{$other->id}/car-of-the-day", ['story_line' => 'Falsches Auto'])->assertStatus(409);
    });

    it('is the owner\'s only', function (Closure $who, int $status) {
        $viewer = $who($this->owner);
        $viewer instanceof User ? Sanctum::actingAs($viewer) : ($viewer !== null ? actingAsStaff($viewer) : null);

        $this->patchJson("/api/v1/vehicles/{$this->car->id}/car-of-the-day", ['story_line' => 'Mein Build'])->assertStatus($status);
    })->with([
        'guest' => [fn (User $o) => null, 401],
        'owner' => [fn (User $o) => $o, 200],
        'other member' => [fn (User $o) => giftMember(), 403],
        'blocked member' => [function (User $o) {
            $member = giftMember();
            giftBlock($o, $member);

            return $member;
        }, 403],
        'restricted owner' => [fn (User $o) => tap($o)->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]])->save() ? $o : $o, 403],
        'staff' => [function () {
            seedStaffRoles();

            return staffWithRole('admin');
        }, 401],
    ]);
});

describe('staff override and skip', function () {
    beforeEach(fn () => seedStaffRoles());

    it('lets staff with content.edit choose another car for today, audited, shown and told at once', function () {
        $first = giftCar(cotdOwner(), 900);
        $chosen = giftCar(cotdOwner(), 100, photos: 1);
        cotdRun('17:55');
        cotdRun('18:00');
        $this->travelTo(cotdAt('19:00'));

        app(OverrideCarOfTheDay::class)->handle(staffWithRole('content_editor'), '2026-07-15', $chosen->id, 'Treffen-Highlight des Tages');
        expect($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day.vehicle.id'))->toBe($chosen->id);

        cotdRun('19:05');
        $event = AuditEvent::query()->where('action', 'car_of_the_day.overridden')->firstOrFail();

        expect($event->before['vehicle_id'])->toBe($first->id)->and($event->after['vehicle_id'])->toBe($chosen->id)
            ->and($event->reason)->toBe('Treffen-Highlight des Tages')
            ->and(Notification::query()->where('notifiable_id', $chosen->owner_id)->where('type', 'car_of_the_day_owner')->exists())->toBeTrue();
    });

    it('skips a day with a reason, audited: Home shows nothing and 17:55 picks nothing', function () {
        giftCar(cotdOwner(), 900);
        app(SkipCarOfTheDay::class)->handle(staffWithRole('admin'), '2026-07-15', 'Wartung am Server');

        cotdRun('17:55');
        cotdRun('18:00');

        expect(CarOfTheDay::query()->firstOrFail()->skipped)->toBeTrue()
            ->and($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day'))->toBeNull()
            ->and(AuditEvent::query()->where('action', 'car_of_the_day.skipped')->value('reason'))->toBe('Wartung am Server');
    });

    it('needs content.edit, a visible car and today or later', function () {
        $car = giftCar(cotdOwner(), 900);

        // At 12:00 Home still shows the 14th (CR-P5G-03), so the 13th is the first day staff cannot change.
        expect(fn () => app(SkipCarOfTheDay::class)->handle(staffWithRole('moderator'), '2026-07-15', 'x'))->toThrow(AuthorizationException::class)
            ->and(fn () => app(OverrideCarOfTheDay::class)->handle(staffWithRole('analyst'), '2026-07-15', $car->id, 'x'))->toThrow(AuthorizationException::class)
            ->and(fn () => app(OverrideCarOfTheDay::class)->handle(staffWithRole('owner'), '2026-07-13', $car->id, 'x'))->toThrow(ValidationException::class)
            ->and(fn () => app(SkipCarOfTheDay::class)->handle(staffWithRole('owner'), '2026-07-13', 'x'))->toThrow(ValidationException::class)
            ->and(fn () => app(OverrideCarOfTheDay::class)->handle(staffWithRole('owner'), '2026-07-15', giftCar(cotdOwner(), 900, attributes: ['visibility' => 'private'])->id, 'x'))->toThrow(ValidationException::class);
    });

    it('replaces the pick Home shows before 18:00, takes the old car\'s notifications back and tells the new one at once (CR-P5G-03/04)', function () {
        ntfPushOn();
        $firstOwner = cotdOwner();
        cotdPush($firstOwner, 'first00000000000000000');
        $first = giftCar($firstOwner, 900);
        $chosenOwner = cotdOwner();
        cotdPush($chosenOwner, 'chosen0000000000000000');
        $chosen = giftCar($chosenOwner, 100, photos: 1);
        $fan = giftMember(['notification_prefs' => ['types' => ['car_of_the_day' => ['push' => true]]]]);
        cotdPush($fan, 'fan000000000000000000');
        cotdRun('17:55', '2026-07-14');
        cotdRun('18:00', '2026-07-14');
        expect(Notification::query()->where('vehicle_id', $first->id)->count())->toBe(2);

        // The next morning, before any runner: Home still shows the 14th.
        $this->travelTo(cotdAt('09:00'));
        app(OverrideCarOfTheDay::class)->handle(staffWithRole('content_editor'), '2026-07-14', $chosen->id, 'Beschwerde zum Auto auf Start');

        expect($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day.vehicle.id'))->toBe($chosen->id)
            ->and(Notification::query()->where('vehicle_id', $first->id)->count())->toBe(0)
            ->and(Notification::query()->where('notifiable_id', $chosenOwner->id)->where('type', 'car_of_the_day_owner')->exists())->toBeTrue()
            ->and(Notification::query()->where('notifiable_id', $fan->id)->where('type', 'car_of_the_day')->value('vehicle_id'))->toBe($chosen->id)
            ->and(CarOfTheDay::query()->where('day', '2026-07-14')->value('notified_at'))->not->toBeNull();
    });

    it('skips the pick Home shows: Home is empty at once and its notifications go', function () {
        $owner = cotdOwner();
        $car = giftCar($owner, 900);
        $fan = giftMember(['notification_prefs' => ['types' => ['car_of_the_day' => ['push' => true]]]]);
        cotdPush($fan, 'fan000000000000000000');
        cotdRun('17:55', '2026-07-14');
        cotdRun('18:00', '2026-07-14');
        $this->travelTo(cotdAt('09:00'));
        expect($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day.vehicle.id'))->toBe($car->id)
            ->and(Notification::query()->where('vehicle_id', $car->id)->count())->toBe(2);

        app(SkipCarOfTheDay::class)->handle(staffWithRole('content_editor'), '2026-07-14', 'Beschwerde zum Auto auf Start');

        expect(app(CarOfTheDays::class)->current())->toBeNull()
            ->and($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day'))->toBeNull()
            ->and(Notification::query()->where('vehicle_id', $car->id)->count())->toBe(0);
    });

    it('checks a car staff chose days ahead again when its day goes live', function () {
        $chosen = giftCar(cotdOwner(), 900);
        app(OverrideCarOfTheDay::class)->handle(staffWithRole('content_editor'), '2026-07-16', $chosen->id, 'Vorgemerkt für Donnerstag');
        $chosen->forceFill(['ghost_mode' => true])->save();

        cotdRun('17:55', '2026-07-16');
        cotdRun('18:00', '2026-07-16');

        expect(CarOfTheDay::query()->where('day', '2026-07-16')->value('skipped'))->toBeTrue()
            ->and(Notification::query()->count())->toBe(0)
            ->and($this->getJson('/api/v1/home/modules')->json('data.car_of_the_day'))->toBeNull();
    });

    it('never lets staff choose a sample in production', function () {
        cotdSamples(true);
        $sample = giftCar(cotdOwner(attributes: ['is_sample' => true]), 900, attributes: ['is_sample' => true]);
        $this->app->detectEnvironment(fn (): string => 'production');

        expect(fn () => app(OverrideCarOfTheDay::class)->handle(staffWithRole('owner'), '2026-07-15', $sample->id, 'x'))->toThrow(ValidationException::class);
    });
});
