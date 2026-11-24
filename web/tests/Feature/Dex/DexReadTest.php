<?php

use App\Enums\Bundesland;
use App\Enums\RestrictionType;
use App\Enums\Visibility;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use Database\Seeders\DexSetSeeder;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b STREET DEX reads (m5.9b contract §3, §4, §10): the reveal, Mein Dex with its filters and counts, the sets with their slots, the
 * DEX-04 card and preview, the rarity rules and the owner's spot numbers with every privacy rule.
 */
describe('GET spots/{spot}', function () {
    it('shows the spotter their spot and nobody else', function () {
        [$car, $code] = dexCar();
        $spotter = dexMember();
        $id = dexSpot($spotter, $code)->assertCreated()->json('data.spot_id');

        $this->getJson("/api/v1/spots/$id")->assertOk()
            ->assertJsonPath('data.spot_id', $id)
            ->assertJsonPath('data.vehicle.id', $car->id)
            ->assertJsonPath('meta.new_in_dex', true)
            ->assertJsonPath('meta.duplicate', false)
            ->assertJsonPath('meta.counted', true);

        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/spots/$id")->assertNotFound();
        Sanctum::actingAs(User::query()->findOrFail($car->owner_id));
        $this->getJson("/api/v1/spots/$id")->assertNotFound();
    });

    it('answers 401 for a guest and 404 once the spotter may no longer see the car', function () {
        [$car, $code] = dexCar();
        $spotter = dexMember();
        $id = dexSpot($spotter, $code)->assertCreated()->json('data.spot_id');
        dexBlock(User::query()->findOrFail($car->owner_id), $spotter);

        $this->getJson("/api/v1/spots/$id")->assertNotFound();

        app('auth')->forgetGuards();
        $this->getJson("/api/v1/spots/$id")->assertUnauthorized();
    });

    it('says "new in Dex" only for the spot that put the car in', function () {
        [, $code] = dexCar();
        $spotter = dexMember();
        $first = dexSpot($spotter, $code)->json('data.spot_id');
        $this->travel(25)->hours();
        $second = dexSpot($spotter, $code)->json('data.spot_id');

        $this->getJson("/api/v1/spots/$first")->assertJsonPath('meta.new_in_dex', true);
        $this->getJson("/api/v1/spots/$second")->assertJsonPath('meta.new_in_dex', false);
    });
});

describe('GET me/dex', function () {
    it('lists one card per car, newest find first, with found and total', function () {
        $spotter = dexMember();
        [$a, $codeA] = dexCar();
        [$b, $codeB] = dexCar();
        dexCar(); // a public car nobody found: part of the total
        dexSpot($spotter, $codeA)->assertCreated();
        $this->travel(25)->hours();
        dexSpot($spotter, $codeA)->assertCreated();
        dexSpot($spotter, $codeB)->assertCreated();

        $response = $this->getJson('/api/v1/me/dex')->assertOk();

        expect(array_column(array_column($response->json('data'), 'vehicle'), 'id'))->toBe([$b->id, $a->id])
            ->and($response->json('meta.found'))->toBe(2)
            ->and($response->json('meta.total'))->toBe(3)
            ->and($response->json('meta'))->toHaveKey('next_cursor');
    });

    it('counts found ghost cars into the total and pages by cursor', function () {
        $spotter = dexMember();
        $codes = [];

        foreach (range(1, 3) as $i) {
            $codes[] = dexCar()[1];
        }

        [, $ghost] = dexCar(attributes: ['ghost_mode' => true]);
        dexCar(attributes: ['ghost_mode' => true]); // a ghost car nobody found: not in the total

        foreach ([...$codes, $ghost] as $code) {
            dexSpot($spotter, $code)->assertCreated();
        }

        $page = $this->getJson('/api/v1/me/dex?per_page=3')->assertOk();
        $next = $this->getJson('/api/v1/me/dex?per_page=3&cursor='.$page->json('meta.next_cursor'))->assertOk();

        expect($page->json('meta.found'))->toBe(4)
            ->and($page->json('meta.total'))->toBe(4)
            ->and(count($page->json('data')))->toBe(3)
            ->and(count($next->json('data')))->toBe(1);
    });

    it('filters by rarity, make and set', function () {
        $this->seed(DexSetSeeder::class);
        $spotter = dexMember();
        [$ghost, $ghostCode] = dexCar(attributes: ['ghost_mode' => true]);
        [$plain, $plainCode] = dexCar();
        dexSpot($spotter, $ghostCode)->assertCreated();
        dexSpot($spotter, $plainCode)->assertCreated();
        $makeSlug = (string) $plain->make?->slug;

        $ids = fn (string $filter): array => array_column(array_column($this->getJson('/api/v1/me/dex?filter='.$filter)->assertOk()->json('data'), 'vehicle'), 'id');

        expect($ids('rarity:ghost'))->toBe([$ghost->id])
            ->and($ids('make:'.$makeSlug))->toBe([$plain->id])
            ->and($ids('set:brand-'.$makeSlug))->toBe([$plain->id])
            ->and($ids('set:jdm-legends'))->toBe([])
            ->and($ids('all'))->toHaveCount(2);
    });

    it('refuses an unknown filter and a forged cursor', function () {
        Sanctum::actingAs(dexMember());

        $this->getJson('/api/v1/me/dex?filter=speed:300')->assertUnprocessable()->assertJsonValidationErrors(['filter']);
        $this->getJson('/api/v1/me/dex?cursor=abc')->assertUnprocessable()->assertJsonValidationErrors(['cursor']);
    });

    it('leaves out cars the member may no longer see', function () {
        $spotter = dexMember();
        [$private, $privateCode] = dexCar();
        [$blocked, $blockedCode] = dexCar();
        [$kept, $keptCode] = dexCar();

        foreach ([$privateCode, $blockedCode, $keptCode] as $code) {
            dexSpot($spotter, $code)->assertCreated();
        }

        $private->forceFill(['visibility' => Visibility::Private])->save();
        dexBlock(User::query()->findOrFail($blocked->owner_id), $spotter);

        $data = $this->getJson('/api/v1/me/dex')->assertOk()->json('data');
        expect(array_column(array_column($data, 'vehicle'), 'id'))->toBe([$kept->id]);
    });

    it('is the member\'s own: guests get 401, a restricted member still reads', function () {
        $this->getJson('/api/v1/me/dex')->assertUnauthorized();
        $this->getJson('/api/v1/me/dex/sets')->assertUnauthorized();

        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());
        $this->getJson('/api/v1/me/dex')->assertOk()->assertJsonPath('meta.found', 0);
    });
});

describe('GET me/dex/sets', function () {
    it('shows JDM slots with make and generation hints, filled by a found car', function () {
        $this->seed(DexSetSeeder::class);
        $nissan = Make::factory()->create(['name' => 'Nissan', 'slug' => 'nissan']);
        $skyline = VehicleModel::factory()->create(['make_id' => $nissan->id, 'name' => 'Skyline GT-R', 'slug' => 'skyline-gt-r']);
        $r34 = Generation::factory()->create(['model_id' => $skyline->id, 'name' => 'R34', 'slug' => 'r34']);
        [$car, $code] = dexCar(attributes: ['make_id' => $nissan->id, 'model_id' => $skyline->id, 'generation_id' => $r34->id, 'model_year' => 2000]);
        $spotter = dexMember();
        dexSpot($spotter, $code)->assertCreated();

        $sets = collect($this->getJson('/api/v1/me/dex/sets')->assertOk()->json('data'))->keyBy('key');
        $jdm = $sets->get('jdm-legends');
        $slots = collect($jdm['slots']);

        expect($jdm['kind'])->toBe('jdm')
            ->and($jdm['progress'])->toBe(1)
            ->and($jdm['target'])->toBe(count(config('speedclub.dex.sets.jdm_legends')))
            ->and($jdm['window'])->toBeNull()
            ->and($slots->where('found', true)->first()['vehicle']['vehicle']['id'])->toBe($car->id)
            ->and($slots->where('found', false)->first()['silhouette'])->toHaveKeys(['make', 'generation'])
            ->and($slots->where('found', false)->first()['vehicle'])->toBeNull()
            ->and($sets->get('saisonstart')['window'])->toBe(['starts_on' => '03-01', 'ends_on' => '04-30'])
            ->and($sets->has('brand-nissan'))->toBeTrue()
            ->and($sets->get('stadtkenner')['slots'])->toHaveCount(10);
    });

    it('counts the season of the current year inside its window only', function () {
        $this->seed(DexSetSeeder::class);
        $this->travelTo(Carbon::parse('2027-03-15 12:00', 'Europe/Berlin'));
        $spotter = dexMember();
        dexSpot($spotter, dexCar()[1])->assertCreated();

        $sets = collect($this->getJson('/api/v1/me/dex/sets')->assertOk()->json('data'))->keyBy('key');

        expect($sets->get('saisonstart')['progress'])->toBe(1)
            ->and($sets->get('saison')['progress'])->toBe(0);
    });

    it('fills the city set from the member\'s best city', function () {
        $this->seed(DexSetSeeder::class);
        $city = dexCity('Düsseldorf', Bundesland::NW);
        $spotter = dexMember();
        dexSpot($spotter, dexCar()[1], ['city_id' => $city->id])->assertCreated();
        dexSpot($spotter, dexCar()[1], ['city_id' => $city->id])->assertCreated();
        dexSpot($spotter, dexCar()[1])->assertCreated();

        $set = collect($this->getJson('/api/v1/me/dex/sets')->assertOk()->json('data'))->firstWhere('key', 'stadtkenner');

        expect($set['progress'])->toBe(2)->and(collect($set['slots'])->where('found', true))->toHaveCount(2);
    });
});

describe('GET vehicles/{id}/dex-card', function () {
    it('shows the card of a spotted car and the preview of a public one', function () {
        [$spotted, $code] = dexCar();
        [$other] = dexCar();
        $spotter = dexMember();
        $spotId = dexSpot($spotter, $code)->json('data.spot_id');

        $this->getJson("/api/v1/vehicles/{$spotted->id}/dex-card")->assertOk()
            ->assertJsonPath('data.spotted', true)->assertJsonPath('data.spot_id', $spotId);
        $this->getJson("/api/v1/vehicles/{$other->id}/dex-card")->assertOk()
            ->assertJsonPath('data.spotted', false)
            ->assertJsonPath('data.spot_id', null)
            ->assertJsonPath('data.spotted_at', null)
            ->assertJsonPath('data.first_spotter', false)
            ->assertJsonPath('data.vehicle.id', $other->id);
    });

    it('never previews a ghost or unlisted car, a private one, or a car behind a block', function (string $case) {
        $owner = dexMember();
        $viewer = dexMember();
        [$car] = dexCar($owner, match ($case) {
            'ghost' => ['ghost_mode' => true],
            'unlisted' => ['visibility' => Visibility::Unlisted],
            'private' => ['visibility' => Visibility::Private],
            default => [],
        });

        if ($case === 'blocked') {
            dexBlock($owner, $viewer);
        }

        Sanctum::actingAs($viewer);
        $this->getJson("/api/v1/vehicles/{$car->id}/dex-card")->assertNotFound();
    })->with(['ghost', 'unlisted', 'private', 'blocked']);

    it('shows a found ghost car, and the owner their own ghost car', function () {
        $owner = dexMember();
        [$car, $code] = dexCar($owner, ['ghost_mode' => true]);
        dexSpot(dexMember(), $code)->assertCreated();

        $this->getJson("/api/v1/vehicles/{$car->id}/dex-card")->assertOk()->assertJsonPath('data.vehicle.rarity', 'ghost');

        Sanctum::actingAs($owner);
        $this->getJson("/api/v1/vehicles/{$car->id}/dex-card")->assertOk()->assertJsonPath('data.spotted', false);
    });

    it('answers 401 for a guest', function () {
        [$car] = dexCar();

        $this->getJson("/api/v1/vehicles/{$car->id}/dex-card")->assertUnauthorized();
    });

    it('labels the cities of day spots, and none while the owner hides them', function () {
        app()->setLocale('en');
        $night = dexCity('Essen');
        $day = dexCity('Bochum');
        [$car, $code] = dexCar();
        $this->travelTo(Carbon::parse('2026-07-10 23:00', 'Europe/Berlin'));
        dexSpot(dexMember(), $code, ['city_id' => $night->id])->assertCreated();
        $this->travelTo(Carbon::parse('2026-07-11 12:00', 'Europe/Berlin'));
        $spotter = dexMember();
        dexSpot($spotter, $code, ['city_id' => $day->id])->assertCreated()->assertJsonPath('data.cities_count_label', 'Spotted in 1 city');

        $car->forceFill(['hide_spot_cities' => true])->save();
        $this->getJson("/api/v1/vehicles/{$car->id}/dex-card")->assertJsonPath('data.cities_count_label', null);
    });
});

describe('GET rarity-rules', function () {
    it('answers guests with the configured thresholds', function () {
        $this->getJson('/api/v1/rarity-rules')->assertOk()->assertExactJson(['data' => [
            'tuned' => ['min_build_score' => 500],
            'rare' => ['max_same_generation' => 5],
            'legend' => ['min_build_score' => 850, 'unique_generation' => true],
            'ghost' => ['opt_in' => true],
        ]])->assertHeader('ETag');
    });
});

describe('GET vehicles/{id}/spot-stats', function () {
    it('is the owner\'s only', function (Closure $who, int $status) {
        $owner = dexMember();
        [$car] = dexCar($owner);
        $viewer = $who($owner);

        if ($viewer instanceof User) {
            Sanctum::actingAs($viewer);
        }

        $this->getJson("/api/v1/vehicles/{$car->id}/spot-stats")->assertStatus($status);
    })->with([
        'guest' => [fn (User $owner): ?User => null, 401],
        'owner' => [fn (User $owner): ?User => $owner, 200],
        'restricted owner' => [function (User $owner): User {
            $owner->forceFill(['restrictions' => ['publishing' => ['until' => null]]])->save();

            return $owner;
        }, 200],
        'other member' => [fn (User $owner): ?User => dexMember(), 403],
        'blocked member' => [function (User $owner): User {
            $member = dexMember();
            dexBlock($owner, $member);

            return $member;
        }, 403],
    ]);

    it('gives totals, day cities, 30 days, named and anonymous spotters and the Street Famous tier', function () {
        $owner = dexMember();
        [$car, $code] = dexCar($owner);
        $essen = dexCity('Essen');
        $bochum = dexCity('Bochum');
        $this->travelTo(Carbon::parse('2026-07-10 12:00', 'Europe/Berlin'));

        $named = dexMember(['username' => 'lena.spot', 'display_name' => 'Lena']);
        $shy = dexMember(['show_my_spots' => false]);
        $blocked = dexMember(['username' => 'blocked.spot']);
        dexSpot($named, $code, ['city_id' => $essen->id])->assertCreated();
        dexSpot($shy, $code, ['city_id' => $essen->id])->assertCreated();
        dexSpot($blocked, $code)->assertCreated();
        $this->travelTo(Carbon::parse('2026-07-10 23:30', 'Europe/Berlin'));
        dexSpot(dexMember(['username' => 'night.spot']), $code, ['city_id' => $bochum->id])->assertCreated();
        dexSpot(User::factory()->create(['created_at' => now()->subHour()]), $code)->assertCreated(); // not counted
        dexBlock($owner, $blocked);
        // Past the alert window of the last spot (nothing live, CR-P5G-01).
        $this->travelTo(Carbon::parse('2026-07-11 02:45', 'Europe/Berlin'));

        Sanctum::actingAs($owner);
        $stats = $this->getJson("/api/v1/vehicles/{$car->id}/spot-stats")->assertOk()->json('data');

        expect($stats['total'])->toBe(4)
            ->and($stats['unique_spotters'])->toBe(4)
            ->and($stats['cities_count'])->toBe(1)
            ->and($stats['cities'])->toBe([['name' => 'Essen', 'count' => 2]])
            ->and($stats['last_30_days'])->toHaveCount(30)
            ->and($stats['last_30_days'][28])->toBe(['day' => '2026-07-10', 'count' => 4])
            ->and(end($stats['last_30_days']))->toBe(['day' => '2026-07-11', 'count' => 0])
            ->and($stats['street_famous'])->toBe(['tier' => null])
            // Newest first; the shy spotter and the one the owner blocked read as "jemand".
            ->and(collect($stats['recent_spotters'])->pluck('username')->filter()->values()->all())->toBe(['night.spot', 'lena.spot'])
            ->and(collect($stats['recent_spotters'])->where('anonymous', true))->toHaveCount(2);

        $car->forceFill(['hide_spot_cities' => true])->save();
        $hidden = $this->getJson("/api/v1/vehicles/{$car->id}/spot-stats")->assertOk()->json('data');

        expect($hidden['cities'])->toBe([])->and($hidden['cities_count'])->toBe(0)->and($hidden['total'])->toBe(4);
    });

    it('names a spotter and fills today\'s bucket only once the owner alert window has passed (nothing live)', function () {
        $owner = dexMember();
        [$car, $code] = dexCar($owner);
        $this->travelTo(Carbon::parse('2026-07-10 12:00', 'Europe/Berlin'));
        dexSpot(dexMember(['username' => 'early.spot']), $code)->assertCreated();
        $this->travelTo(Carbon::parse('2026-07-10 16:00', 'Europe/Berlin'));
        dexSpot(dexMember(['username' => 'fresh.spot']), $code)->assertCreated();

        Sanctum::actingAs($owner);
        $now = $this->getJson("/api/v1/vehicles/{$car->id}/spot-stats")->assertOk()->json('data');

        // The totals stay current; who and when wait for the window (dex.alerts.window_hours = 3).
        expect($now['total'])->toBe(2)
            ->and(collect($now['recent_spotters'])->pluck('username')->all())->toBe(['early.spot'])
            ->and(end($now['last_30_days']))->toBe(['day' => '2026-07-10', 'count' => 1]);

        $this->travelTo(Carbon::parse('2026-07-10 18:59', 'Europe/Berlin'));
        expect(collect($this->getJson("/api/v1/vehicles/{$car->id}/spot-stats")->json('data.recent_spotters'))->pluck('username')->all())->toBe(['early.spot']);

        $this->travelTo(Carbon::parse('2026-07-10 19:01', 'Europe/Berlin'));
        $later = $this->getJson("/api/v1/vehicles/{$car->id}/spot-stats")->assertOk()->json('data');

        expect(collect($later['recent_spotters'])->pluck('username')->all())->toBe(['fresh.spot', 'early.spot'])
            ->and(end($later['last_30_days']))->toBe(['day' => '2026-07-10', 'count' => 2]);
    });

    it('reaches Street Famous at 10 unique spotters', function () {
        [$car, $code] = dexCar();

        foreach (range(1, 10) as $i) {
            dexSpot(dexMember(), $code)->assertCreated();
        }

        Sanctum::actingAs(Vehicle::query()->findOrFail($car->id)->owner);
        $this->getJson("/api/v1/vehicles/{$car->id}/spot-stats")->assertOk()->assertJsonPath('data.street_famous.tier', 10);
        expect(Spot::query()->count())->toBe(10);
    });
});
