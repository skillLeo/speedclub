<?php

use App\Actions\Admin\Members\StartViewAs;
use App\Enums\RestrictionType;
use App\Enums\ViewSource;
use App\Enums\Visibility;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\Follow;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Reaction;
use App\Models\Save;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleFollow;
use App\Models\ViewDay;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EngagementTestHelpers.php';
require_once __DIR__.'/../Admin/Actions/Helpers.php';

/**
 * M5.7 INS-01 (10 §6.1, m5.7-contract §3.2–§3.4, §10): GET me/insights and GET vehicles/{id}/insights, owner-only, sums only.
 */
beforeEach(function () {
    $this->withoutDefer();
    engFlag();
    // A Wednesday noon in Germany: "this week" = the last 7 Berlin days incl. today.
    $this->travelTo(CarbonImmutable::parse('2026-11-18 12:00', 'Europe/Berlin'));
    $this->owner = User::factory()->create(['username' => 'max.e46', 'created_at' => now()->subYear()]);
    $this->car = publishedVehicle($this->owner, ['visibility' => Visibility::Public, 'nickname' => 'E46', 'created_at' => now()->subYear()]);
});

function engInsights(User $as, ?Vehicle $vehicle = null, string $locale = 'de'): TestResponse
{
    Sanctum::actingAs($as);

    return test()->getJson($vehicle === null ? '/api/v1/me/insights' : "/api/v1/vehicles/{$vehicle->id}/insights", ['Accept-Language' => $locale]);
}

describe('the report', function () {
    it('compares this week with last week, with the series, sources and the headline', function () {
        // This week (days 0–6): 128 views; last week (days 7–13): 98.
        engSeedVehicleDays($this->car, [0 => 20, 3 => 60, 6 => 40]);
        engSeedVehicleDays($this->car, [1 => 8], ViewSource::StickerScan);
        engSeedVehicleDays($this->car, [7 => 50, 13 => 48]);
        engSeedVehicleDays($this->car, [29 => 5], ViewSource::SharedLink);
        engSeedVehicleDays($this->car, [30 => 999]);

        $data = engInsights($this->owner, $this->car)->assertOk()->json('data');

        expect($data['scope'])->toBe('vehicle')
            ->and($data['vehicle']['id'])->toBe($this->car->id)
            ->and($data['views'])->toBe(['this_week' => 128, 'last_week' => 98, 'delta_percent' => 31, 'trend' => 'up', 'total_30_days' => 231])
            ->and($data['headline'])->toBe('Dein E46 wurde diese Woche 128-mal angesehen – 31 % mehr als letzte Woche.')
            ->and($data['days'])->toHaveCount(30)
            ->and($data['days'][0]['date'])->toBe('2026-10-20')
            ->and($data['days'][29])->toBe(['date' => '2026-11-18', 'views' => 20, 'scans' => 0])
            ->and(array_column($data['sources'], 'source'))->toBe(['app', 'sticker_scan', 'shared_link', 'web'])
            ->and($data['sources'][0])->toBe(['source' => 'app', 'label' => 'App', 'views' => 218, 'percent' => 94])
            ->and($data['sources'][3])->toBe(['source' => 'web', 'label' => 'Web', 'views' => 0, 'percent' => 0])
            ->and($data['breakdown'])->toBe([])
            ->and($data['follows']['profile'])->toBeNull()
            ->and($data['sticker_scans'])->toBeNull();

        expect(engInsights($this->owner, $this->car, 'en')->json('data.headline'))->toBe('Your E46 was viewed 128 times this week – 31% more than last week.');
    });

    it('gives no percentage below the base, says "new" after an empty week, and never words a drop as a loss', function (array $seed, ?int $delta, string $trend, string $headline) {
        engSeedVehicleDays($this->car, $seed);

        $data = engInsights($this->owner, $this->car)->json('data');

        expect($data['views']['delta_percent'])->toBe($delta)
            ->and($data['views']['trend'])->toBe($trend)
            ->and($data['headline'])->toBe($headline)
            ->and($data['headline'])->not->toMatch('/weniger|gesunken|verloren|minus|%/u');
    })->with([
        'small base' => [[0 => 4, 8 => 1], null, 'up', 'Dein E46 wurde diese Woche 4-mal angesehen.'],
        'down' => [[0 => 30, 8 => 60], -50, 'down', 'Dein E46 wurde diese Woche 30-mal angesehen. Letzte Woche waren es 60.'],
        'same' => [[0 => 10, 8 => 10], 0, 'same', 'Dein E46 wurde diese Woche 10-mal angesehen.'],
        'new' => [[0 => 1], null, 'new', 'Diese Woche wurde dein E46 zum ersten Mal angesehen: einmal.'],
        'zero' => [[8 => 3], null, 'down', 'Diese Woche noch keine Aufrufe. Teil deinen Build, damit ihn mehr Leute sehen.'],
    ]);

    it('asks the profile scope to share the profile and a car\'s scope to share the build when nothing was viewed this week', function () {
        expect(engInsights($this->owner, $this->car)->json('data.headline'))->toBe('Diese Woche noch keine Aufrufe. Teil deinen Build, damit ihn mehr Leute sehen.')
            ->and(engInsights($this->owner)->json('data.headline'))->toBe('Diese Woche noch keine Aufrufe. Teil dein Profil, damit es mehr Leute sehen.')
            ->and(engInsights($this->owner, null, 'en')->json('data.headline'))->toBe('No views yet this week. Share your profile so more people see it.');
    });

    it('counts sticker scans, spots, new followers, saves and reactions of the scope', function () {
        $code = QrCode::factory()->create(['vehicle_id' => $this->car->id]);
        QrScanDaily::factory()->create(['qr_code_id' => $code->id, 'day' => '2026-11-17', 'count' => 9]);
        QrScanDaily::factory()->create(['qr_code_id' => $code->id, 'day' => '2026-11-10', 'count' => 4]);
        QrScanDaily::factory()->create(['qr_code_id' => $code->id, 'day' => '2026-01-10', 'count' => 100]);
        $thisWeek = now()->subDays(2);
        $lastWeek = now()->subDays(9);
        Spot::factory()->count(2)->create(['vehicle_id' => $this->car->id, 'created_at' => $thisWeek]);
        Spot::factory()->create(['vehicle_id' => $this->car->id, 'created_at' => $lastWeek]);
        Spot::factory()->create(['vehicle_id' => $this->car->id, 'created_at' => $thisWeek, 'counted' => false]);
        Follow::factory()->create(['followee_id' => $this->owner->id, 'created_at' => $thisWeek]);
        Follow::factory()->create(['followee_id' => $this->owner->id, 'created_at' => $lastWeek]);
        VehicleFollow::factory()->create(['vehicle_id' => $this->car->id, 'created_at' => $thisWeek]);
        Save::factory()->count(3)->create(['vehicle_id' => $this->car->id, 'created_at' => $thisWeek]);
        Save::factory()->create(['vehicle_id' => $this->car->id, 'created_at' => now()->subDays(20)]);
        $update = BuildUpdate::factory()->post()->create(['vehicle_id' => $this->car->id]);
        Reaction::factory()->create(['reactable_type' => 'vehicle', 'reactable_id' => $this->car->id, 'type' => 'strong', 'created_at' => $thisWeek]);
        Reaction::factory()->create(['reactable_type' => 'build_update', 'reactable_id' => $update->id, 'type' => 'strong', 'created_at' => $thisWeek]);
        Reaction::factory()->create(['reactable_type' => 'build_update', 'reactable_id' => $update->id, 'type' => 'low', 'created_at' => $lastWeek]);
        // Somebody else's car: never in the numbers.
        Save::factory()->create(['created_at' => $thisWeek]);

        $data = engInsights($this->owner)->assertOk()->json('data');

        expect($data['scope'])->toBe('account')
            ->and($data['sticker_scans'])->toBe(['this_week' => 9, 'last_week' => 4, 'total_30_days' => 13, 'total' => 113])
            ->and($data['days'][28]['scans'])->toBe(9)
            ->and($data['spots'])->toBe(['this_week' => 2, 'last_week' => 1])
            ->and($data['follows'])->toBe(['profile' => ['this_week' => 1, 'last_week' => 1], 'vehicles' => ['this_week' => 1, 'last_week' => 0]])
            ->and($data['saves'])->toBe(['this_week' => 3, 'last_week' => 0])
            ->and($data['reactions']['this_week'])->toBe(2)
            ->and($data['reactions']['last_week'])->toBe(1)
            ->and($data['reactions']['by_type'][0])->toBe(['type' => 'strong', 'label' => 'Stark', 'count' => 2])
            ->and(array_column($data['reactions']['by_type'], 'type'))->toBe(['strong', 'like', 'clean', 'low', 'loud']);
    });

    it('adds up the profile and every car in the account scope, with a breakdown of published cars', function () {
        $second = publishedVehicle($this->owner, ['visibility' => Visibility::Public]);
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        $deleted = publishedVehicle($this->owner);
        engSeedVehicleDays($this->car, [0 => 10]);
        engSeedVehicleDays($second, [1 => 5]);
        engSeedVehicleDays($deleted, [1 => 50]);
        $deleted->delete();
        ViewDay::factory()->forProfile($this->owner)->create(['day' => '2026-11-18', 'views' => 7, 'source' => ViewSource::Web]);
        ViewDay::factory()->forProfile(User::factory()->create())->create(['day' => '2026-11-18', 'views' => 70]);

        $data = engInsights($this->owner, null, 'de')->json('data');

        expect($data['views']['this_week'])->toBe(22)
            ->and($data['headline'])->toBe('Diese Woche wurde deine Garage zum ersten Mal angesehen: 22-mal.')
            ->and(array_map(fn (array $row): array => [$row['subject'], $row['vehicle']['id'] ?? null, $row['views_this_week']], $data['breakdown']))
            ->toBe([['profile', null, 7], ['vehicle', $this->car->id, 10], ['vehicle', $second->id, 5]])
            ->and(collect($data['breakdown'])->pluck('vehicle.id')->all())->not->toContain($draft->id);
    });

    it('says since when it counts', function () {
        expect(engInsights($this->owner, $this->car)->json('data.counting_since'))->toBeNull();

        ViewDay::factory()->forProfile(User::factory()->create())->create(['day' => '2026-11-01']);
        $young = publishedVehicle($this->owner, ['created_at' => CarbonImmutable::parse('2026-11-10 09:00', 'Europe/Berlin')]);

        expect(engInsights($this->owner, $this->car)->json('data.counting_since'))->toBe('2026-11-01')
            ->and(engInsights($this->owner, $young)->json('data.counting_since'))->toBe('2026-11-10');
    });

    it('never names a viewer: no member id, username or hash in the answer', function () {
        $viewers = User::factory()->count(3)->create();

        foreach ($viewers as $viewer) {
            engVehicleView($viewer, $this->car);
            engBeacon($viewer, ['subject' => 'profile', 'username' => 'max.e46', 'source' => 'app']);
        }

        $body = engInsights($this->owner)->assertOk()->getContent();
        $vehicleBody = engInsights($this->owner, $this->car)->getContent();

        expect(json_decode((string) $body, true)['data']['views']['this_week'])->toBe(6);

        foreach ($viewers as $viewer) {
            expect($body)->not->toContain($viewer->id)->not->toContain((string) $viewer->username)
                ->and($vehicleBody)->not->toContain($viewer->id)->not->toContain((string) $viewer->username);
        }

        foreach (DB::table('view_events')->pluck('viewer_hash') as $hash) {
            expect($body)->not->toContain((string) $hash);
        }

        // No view number on any public surface.
        app('auth')->forgetGuards();
        $public = $this->getJson('/api/v1/public/vehicles/'.$this->car->canonicalSlug())->json('data');
        expect(array_keys($public))->not->toContain('views', 'view_count', 'views_count', 'insights')
            ->and(array_keys($public['stats'] ?? []))->not->toContain('views');
    });

    it('may be kept privately for 60 s and answers 304 to a matching ETag within the minute', function () {
        $first = engInsights($this->owner, $this->car)->assertOk();
        expect($first->headers->get('Cache-Control'))->toContain('private')->toContain('max-age=60');
        $etag = $first->headers->get('ETag');
        $this->travel(20)->seconds();

        $this->getJson("/api/v1/vehicles/{$this->car->id}/insights", ['If-None-Match' => (string) $etag, 'Accept-Language' => 'de'])->assertStatus(304);
    });
});

describe('who may read it', function () {
    it('lets only the owner read a car\'s statistics', function (Closure $who, int $status, ?string $code) {
        $viewer = $who($this->owner);
        app('auth')->forgetGuards();

        if ($viewer instanceof User) {
            Sanctum::actingAs($viewer);
        }

        $response = $this->getJson("/api/v1/vehicles/{$this->car->id}/insights")->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with([
        'guest' => [fn (): ?User => null, 401, null],
        'owner' => [fn (User $owner): User => $owner, 200, null],
        'other member' => [fn (): User => User::factory()->create(), 403, 'forbidden'],
        'member the owner blocked' => [function (User $owner): User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return $member;
        }, 403, 'forbidden'],
        'member who blocked the owner' => [function (User $owner): User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $owner->id]);

            return $member;
        }, 403, 'forbidden'],
        'restricted owner' => [function (User $owner): User {
            $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]])->save();

            return $owner;
        }, 200, null],
    ]);

    it('lets every member read their own account statistics, guests not', function () {
        app('auth')->forgetGuards();
        $this->getJson('/api/v1/me/insights')->assertUnauthorized();

        engInsights(User::factory()->unverified()->create())->assertOk()->assertJsonPath('data.views.this_week', 0);
        engInsights(User::factory()->restrictedFrom(RestrictionType::Publishing)->create())->assertOk();
    });

    it('refuses staff in view-as, read-only or not: owner-only like the budget', function () {
        Mail::fake();
        $token = app(StartViewAs::class)->handle(m31Staff('admin'), $this->owner, m32Reason(), false)['token'];
        app('auth')->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/me/insights')->assertForbidden()->assertJsonPath('code', 'view_as_read_only');
        $this->withToken($token)->getJson("/api/v1/vehicles/{$this->car->id}/insights")->assertForbidden()->assertJsonPath('code', 'view_as_read_only');
    });

    it('answers 404 for a deleted car and while the flag is off', function () {
        engFlag(false);
        engInsights($this->owner)->assertNotFound()->assertJsonPath('code', 'feature_disabled');

        engFlag();
        $this->car->delete();
        engInsights($this->owner, $this->car)->assertNotFound();
    });

    it('is rate limited per member', function () {
        Sanctum::actingAs($this->owner);

        for ($i = 0; $i < 60; $i++) {
            $this->getJson('/api/v1/me/insights')->assertOk();
        }

        $this->getJson('/api/v1/me/insights')->assertTooManyRequests();
    });
});
