<?php

use App\Enums\Bundesland;
use App\Enums\QrRevocationReason;
use App\Enums\RestrictionType;
use App\Enums\Visibility;
use App\Http\RateLimits;
use App\Models\QrCode;
use App\Models\Spot;
use App\Models\User;
use App\Models\VehicleSpotStat;
use Database\Seeders\DexSetSeeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b STREET DEX, POST spots (10 §16.2, m5.9b contract §2, §10): every rejection rule, the 24 h duplicate, the young account, the
 * night flag, the first three spotters, the city rules, the rate limit and the idempotency key.
 */
describe('a new spot', function () {
    it('answers 201 with the card and what the spot did', function () {
        [$car, $code] = dexCar(dexMember(['username' => 'owner.ek9', 'display_name' => 'Ole']));
        $spotter = dexMember();

        $response = dexSpot($spotter, strtolower($code))->assertCreated();

        $spot = Spot::query()->sole();
        $response->assertJsonPath('data.spot_id', $spot->id)
            ->assertJsonPath('data.spotted', true)
            ->assertJsonPath('data.vehicle.id', $car->id)
            ->assertJsonPath('data.vehicle.slug', $car->slug)
            ->assertJsonPath('data.vehicle.make_slug', $car->make?->slug)
            ->assertJsonPath('data.vehicle.generation_slug', $car->generation?->slug)
            ->assertJsonPath('data.vehicle.ghost', false)
            ->assertJsonPath('data.vehicle.owner.username', 'owner.ek9')
            ->assertJsonPath('data.first_spotter', true)
            ->assertJsonPath('meta.new_in_dex', true)
            ->assertJsonPath('meta.duplicate', false)
            ->assertJsonPath('meta.first_spotter', true)
            ->assertJsonPath('meta.counted', true)
            ->assertJsonPath('meta.reason', null);

        expect($response->json('data.vehicle.dex_number'))->toBeInt()
            ->and($response->json('data.vehicle.rarity'))->toBeIn(['street', 'rare', 'legend'])
            ->and($spot->counted)->toBeTrue()
            ->and($spot->spotter_id)->toBe($spotter->id)
            ->and(VehicleSpotStat::query()->find($car->id)?->total)->toBe(1);
    });

    it('hides the owner when they do not want to be named on sticker pages', function () {
        [, $code] = dexCar(dexMember(['show_owner_on_qr' => false]));

        dexSpot(dexMember(), $code)->assertCreated()->assertJsonPath('data.vehicle.owner', null);
    });

    it('answers the same car again within 24 h with the existing card (200, duplicate)', function () {
        [$car, $code] = dexCar();
        $spotter = dexMember();
        $first = dexSpot($spotter, $code)->assertCreated()->json('data.spot_id');

        $this->travel(23)->hours();
        dexSpot($spotter, $code)->assertOk()
            ->assertJsonPath('data.spot_id', $first)
            ->assertJsonPath('meta.duplicate', true)
            ->assertJsonPath('meta.new_in_dex', false);

        expect(Spot::query()->count())->toBe(1);

        $this->travel(2)->hours();
        dexSpot($spotter, $code)->assertCreated()->assertJsonPath('meta.new_in_dex', false)->assertJsonPath('meta.duplicate', false);

        expect(Spot::query()->count())->toBe(2)
            ->and(VehicleSpotStat::query()->find($car->id)?->total)->toBe(2)
            ->and(VehicleSpotStat::query()->find($car->id)?->unique_spotters)->toBe(1);
    });

    it('stores but does not count a spot of an account younger than 24 h', function () {
        [$car, $code] = dexCar();
        $young = User::factory()->create(['created_at' => now()->subHours(23)]);

        dexSpot($young, $code)->assertCreated()
            ->assertJsonPath('meta.counted', false)
            ->assertJsonPath('meta.reason', 'account_too_new')
            ->assertJsonPath('meta.new_in_dex', false)
            ->assertJsonPath('meta.first_spotter', false)
            ->assertJsonPath('meta.set_progress', []);

        expect(Spot::query()->sole()->counted)->toBeFalse()
            ->and(VehicleSpotStat::query()->find($car->id))->toBeNull();

        Sanctum::actingAs($young);
        expect($this->getJson('/api/v1/me/dex')->assertOk()->json('meta.found'))->toBe(0);
    });

    it('works for a ghost car: the in-person reveal', function () {
        [, $code] = dexCar(attributes: ['ghost_mode' => true]);

        dexSpot(dexMember(), $code)->assertCreated()
            ->assertJsonPath('data.vehicle.ghost', true)
            ->assertJsonPath('data.vehicle.rarity', 'ghost');
    });

    it('also spots an unlisted car (reachable by its sticker)', function () {
        [, $code] = dexCar(attributes: ['visibility' => Visibility::Unlisted]);

        dexSpot(dexMember(), $code)->assertCreated();
    });

    it('moves the sets the spot counts for', function () {
        $this->seed(DexSetSeeder::class);
        [$car, $code] = dexCar();

        $moves = dexSpot(dexMember(), $code)->assertCreated()->json('meta.set_progress');
        $brand = collect($moves)->firstWhere('key', 'brand-'.$car->make?->slug);

        expect($brand)->toMatchArray(['progress' => 1, 'target' => 5, 'completed' => false]);
    });
});

describe('refusals', function () {
    it('answers 404 qr_not_found for a code that is no sticker of ours', function () {
        dexSpot(dexMember(), 'ZZZZZZZZ')->assertNotFound()->assertJsonPath('code', 'qr_not_found');
        dexSpot(dexMember(), 'not a code')->assertNotFound()->assertJsonPath('code', 'qr_not_found');
    });

    it('answers 409 spot_unavailable for a revoked code', function () {
        [$car] = dexCar();
        $old = QrCode::factory()->revoked(QrRevocationReason::Reissued)->create(['vehicle_id' => $car->id]);

        dexSpot(dexMember(), $old->code)->assertConflict()->assertJsonPath('code', 'spot_unavailable');
    });

    it('answers 409 spot_unavailable for a private, deleted or draft car', function (string $case) {
        [$car, $code] = dexCar();

        match ($case) {
            'private' => $car->forceFill(['visibility' => Visibility::Private])->save(),
            'deleted' => $car->delete(),
            'draft' => $car->forceFill(['status' => 'draft'])->save(),
        };

        dexSpot(dexMember(), $code)->assertConflict()->assertJsonPath('code', 'spot_unavailable');
        expect(Spot::query()->count())->toBe(0);
    })->with(['private', 'deleted', 'draft']);

    it('answers 409 spot_unavailable with a block in either direction', function (bool $ownerBlocks) {
        $owner = dexMember();
        [, $code] = dexCar($owner);
        $spotter = dexMember();
        $ownerBlocks ? dexBlock($owner, $spotter) : dexBlock($spotter, $owner);

        dexSpot($spotter, $code)->assertConflict()->assertJsonPath('code', 'spot_unavailable');
    })->with(['the owner blocked the spotter' => [true], 'the spotter blocked the owner' => [false]]);

    it('answers 409 spot_own_car for the own car', function () {
        $owner = dexMember();
        [, $code] = dexCar($owner);

        dexSpot($owner, $code)->assertConflict()->assertJsonPath('code', 'spot_own_car');
    });

    it('answers 409 spotting_paused while the owner paused spotting', function () {
        [, $code] = dexCar(attributes: ['spotting_paused' => true]);

        dexSpot(dexMember(), $code)->assertConflict()->assertJsonPath('code', 'spotting_paused');
        expect(Spot::query()->count())->toBe(0);
    });

    it('needs a signed-in, verified and unrestricted member', function () {
        [, $code] = dexCar();

        $this->postJson('/api/v1/spots', ['code' => $code])->assertUnauthorized();
        dexSpot(dexMember(['email_verified_at' => null]), $code)->assertForbidden()->assertJsonPath('code', 'email_not_verified');
        dexSpot(User::factory()->restrictedFrom(RestrictionType::Publishing)->create(['created_at' => now()->subDays(3)]), $code)
            ->assertForbidden()->assertJsonPath('code', 'account_restricted');

        expect(Spot::query()->count())->toBe(0);
    });
});

describe('validation', function () {
    it('refuses coordinates and any other unknown field with 422', function (array $extra, string $field) {
        [, $code] = dexCar();

        dexSpot(dexMember(), $code, $extra)->assertUnprocessable()->assertJsonValidationErrors([$field]);
        expect(Spot::query()->count())->toBe(0);
    })->with([
        'lat' => [['lat' => 51.22], 'lat'],
        'lng' => [['lng' => 6.77], 'lng'],
        'latitude' => [['latitude' => 51.22], 'latitude'],
        'location' => [['location' => ['lat' => 51.2, 'lng' => 6.7]], 'location'],
        'anything' => [['foo' => 'bar'], 'foo'],
    ]);

    it('needs a code, a known city id and a Bundesland code', function (array $body, string $field) {
        Sanctum::actingAs(dexMember());

        $this->postJson('/api/v1/spots', $body)->assertUnprocessable()->assertJsonValidationErrors([$field]);
    })->with([
        'no code' => [[], 'code'],
        'unknown city' => [['code' => 'ABCDEFGH', 'city_id' => 1], 'city_id'],
        'wrong Bundesland' => [['code' => 'ABCDEFGH', 'bundesland' => 'XX'], 'bundesland'],
        'long city' => [['code' => 'ABCDEFGH', 'city' => str_repeat('a', 81)], 'city'],
    ]);
});

describe('place', function () {
    it('takes the city id, whose Bundesland wins over a sent one', function () {
        $city = dexCity('Düsseldorf', Bundesland::NW);
        [, $code] = dexCar();

        dexSpot(dexMember(), $code, ['city_id' => $city->id, 'bundesland' => 'BY'])->assertCreated();

        $spot = Spot::query()->sole();
        expect($spot->city_id)->toBe($city->id)->and($spot->bundesland)->toBe(Bundesland::NW);
    });

    it('matches a city name, narrowed by the Bundesland, the largest place first', function () {
        dexCity('Neustadt', Bundesland::RP, 50_000);
        $hessen = dexCity('Neustadt', Bundesland::HE, 9_000);
        $koeln = dexCity('Köln', Bundesland::NW, 1_000_000);
        [, $code] = dexCar();
        [, $other] = dexCar();

        dexSpot(dexMember(), $code, ['city' => 'neustadt', 'bundesland' => 'HE'])->assertCreated();
        dexSpot(dexMember(), $other, ['city' => 'Koeln'])->assertCreated();

        expect(Spot::query()->orderBy('id')->pluck('city_id')->all())->toBe([$hessen->id, $koeln->id]);
    });

    it('stores no city, never free text, when the name matches nothing', function () {
        [, $code] = dexCar();

        dexSpot(dexMember(), $code, ['city' => 'Atlantis', 'bundesland' => 'SH'])->assertCreated();

        $spot = Spot::query()->sole();
        expect($spot->city_id)->toBeNull()->and($spot->bundesland)->toBe(Bundesland::SH);
    });
});

describe('night', function () {
    it('flags spots from 22:00 to 06:00 Europe/Berlin', function (string $berlin, bool $night) {
        $this->travelTo(Carbon::parse("2026-07-10 $berlin", 'Europe/Berlin'));
        [, $code] = dexCar();

        dexSpot(dexMember(), $code)->assertCreated();

        expect(Spot::query()->sole()->is_night)->toBe($night);
    })->with([
        '21:59' => ['21:59', false],
        '22:00' => ['22:00', true],
        '03:00' => ['03:00', true],
        '05:59' => ['05:59', true],
        '06:00' => ['06:00', false],
        '14:00' => ['14:00', false],
    ]);
});

describe('first spotters', function () {
    it('gives the foil to the first three unique counted spotters only, for good', function () {
        [$car, $code] = dexCar();
        $young = User::factory()->create(['created_at' => now()->subHour()]);
        dexSpot($young, $code)->assertCreated()->assertJsonPath('meta.first_spotter', false);

        $spotters = [dexMember(), dexMember(), dexMember(), dexMember()];
        $foils = array_map(fn (User $spotter): bool => dexSpot($spotter, $code)->assertCreated()->json('meta.first_spotter'), $spotters);

        expect($foils)->toBe([true, true, true, false]);

        // A first spotter keeps the foil on a later spot; the fourth never gets one.
        $this->travel(25)->hours();
        dexSpot($spotters[0], $code)->assertCreated()->assertJsonPath('data.first_spotter', true);
        dexSpot($spotters[3], $code)->assertCreated()->assertJsonPath('data.first_spotter', false);

        expect(Spot::query()->where('vehicle_id', $car->id)->where('is_first_three', true)->distinct()->count('spotter_id'))->toBe(3);
    });
});

describe('limits', function () {
    it('allows 30 spots an hour, then answers 429 with Retry-After', function () {
        $spotter = dexMember();
        RateLimiter::clear('spots|user:'.$spotter->id);
        $cars = [];

        for ($i = 0; $i < 31; $i++) {
            $cars[] = dexCar()[1];
        }

        foreach (array_slice($cars, 0, 30) as $code) {
            dexSpot($spotter, $code)->assertCreated();
        }

        dexSpot($spotter, $cars[30])->assertStatus(429)->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
        expect(Spot::query()->count())->toBe(30)
            ->and(in_array('spots', RateLimits::names(), true))->toBeTrue();
    });

    it('replays a retried request with the same Idempotency-Key instead of spotting twice', function () {
        [, $code] = dexCar();
        $spotter = dexMember();
        $key = (string) str()->uuid();

        $first = dexSpot($spotter, $code, [], ['Idempotency-Key' => $key])->assertCreated();
        $again = dexSpot($spotter, $code, [], ['Idempotency-Key' => $key])->assertCreated();

        expect($again->json('data.spot_id'))->toBe($first->json('data.spot_id'))
            ->and(Spot::query()->count())->toBe(1);
    });
});
