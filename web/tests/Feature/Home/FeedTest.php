<?php

use App\Actions\Social\BlockMember;
use App\Enums\RestrictionType;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\Garage\VehiclePresenter;
use App\Services\Home\StreamCursor;
use App\Services\Home\StreamState;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/HomeTestHelpers.php';

/**
 * M2.2 GET feed: "Für dich" (ranked, guests too) and "Folge ich" (chronological, members only), 02_PRODUCT_SPEC §3.8.
 */
beforeEach(function () {
    // The featured hero and the first Neue Builds leave the stream; most tests switch the hero off so they read the stream alone.
    config(['speedclub.home.featured_limit' => 0]);
});

describe('tab=for_you', function () {
    it('takes guests and answers the exact shape', function () {
        $a = homeBuild(ntfMember('lukas.sc'));
        $b = homeBuild();
        $c = homeBuild();
        $d = homeBuild();
        homeOrder([$a, $b, $c, $d]);
        // The two newest builds are "Neue Builds" above the stream.
        DB::table('vehicle_search')->whereIn('vehicle_id', [$c->id, $d->id])->update(['updated_at' => now()->addMinute()]);

        $response = $this->getJson('/api/v1/feed?tab=for_you')->assertOk()->assertHeader('ETag');

        expect(array_keys($response->json()))->toBe(['data', 'meta'])
            ->and($response->json('meta'))->toBe(['next_cursor' => null, 'per_page' => 20, 'suggestions' => null])
            ->and($response->json('data.*.key'))->toBe(["vehicle:{$a->id}", "vehicle:{$b->id}"])
            ->and(array_keys($response->json('data.0')))->toBe(['type', 'key', 'vehicle', 'update'])
            ->and($response->json('data.0.type'))->toBe('vehicle')
            ->and($response->json('data.0.update'))->toBeNull()
            ->and($response->json('data.0.vehicle.id'))->toBe($a->id)
            ->and($response->json('data.0.vehicle.owner.username'))->toBe('lukas.sc');
    });

    it('leaves out the featured builds, the first two Neue Builds and the Build-Updates module', function () {
        config(['speedclub.home.featured_limit' => 1, 'speedclub.home.featured_slugs' => []]);
        $builds = collect(range(1, 6))->map(fn (int $i) => homeBuild(hoursAgo: $i));
        homeOrder($builds->all());
        $moduleUpdate = ntfUpdate($builds[5]);
        $streamUpdate = ntfUpdate($builds[4], now()->subDay()->toDateTimeString());
        config(['speedclub.home.build_update_rows' => 1]);

        $featured = $this->getJson('/api/v1/home/featured')->json('data.0.vehicle.id');
        $newBuilds = $this->getJson('/api/v1/home/new-builds?per_page=2')->json('data.*.id');
        $keys = homeReadFeed('for_you', 20);

        // The hero may also be one of the Neue Builds.
        $shown = array_values(array_unique([$featured, ...$newBuilds]));
        expect($featured)->not->toBeNull()
            ->and($newBuilds)->toHaveCount(2)
            ->and(array_intersect($keys, array_map(fn (string $id) => "vehicle:$id", $shown)))->toBe([])
            ->and($keys)->not->toContain("update:{$moduleUpdate->id}")
            ->and(count(array_filter($keys, fn (string $key) => str_starts_with($key, 'vehicle:'))))->toBe(6 - count($shown));
        expect($this->getJson('/api/v1/home/modules')->json('data.build_updates.0.id'))->toBe($moduleUpdate->id);
    });

    it('never shows three items of one owner in a row, on a page or across pages', function (int $perPage) {
        $busy = User::factory()->create();
        $builds = [
            ...collect(range(1, 6))->map(fn () => homeBuild($busy))->all(),
            homeBuild(), homeBuild(), homeBuild(),
        ];
        // The busy owner holds the six best scores.
        homeOrder($builds);
        config(['speedclub.home.featured_limit' => 0]);
        // Neue Builds would take two of the stream; give them a build outside it.
        DB::table('vehicle_search')->whereIn('vehicle_id', [homeBuild()->id, homeBuild()->id])->update(['updated_at' => now()->addHour(), 'rank_score' => -1]);

        $keys = homeReadFeed('for_you', $perPage);
        $owners = Vehicle::query()->whereKey(array_map(fn (string $key) => substr($key, 8), $keys))->pluck('owner_id', 'id');
        $sequence = array_map(fn (string $key) => $owners[substr($key, 8)], $keys);
        $run = 1;
        $longest = 1;

        foreach ($sequence as $i => $owner) {
            $run = $i > 0 && $sequence[$i - 1] === $owner ? $run + 1 : 1;
            $longest = max($longest, $run);
        }

        expect(count($keys))->toBe(9)
            ->and(count(array_unique($keys)))->toBe(9)
            ->and($longest)->toBe(2)
            ->and($keys)->toBe(homeReadFeed('for_you', 30));
    })->with([1, 2, 4, 30]);

    it('puts the latest update of another build after every three cards', function () {
        $builds = collect(range(1, 7))->map(fn () => homeBuild())->all();
        homeOrder($builds);
        DB::table('vehicle_search')->whereIn('vehicle_id', [homeBuild()->id, homeBuild()->id])->update(['updated_at' => now()->addHour(), 'rank_score' => -1]);
        $elsewhere = homeBuild();
        VehicleSearch::query()->whereKey($elsewhere->id)->toBase()->update(['rank_score' => -2]);
        ntfUpdate($elsewhere, now()->subDays(3)->toDateTimeString());
        $latest = ntfUpdate($elsewhere, now()->subDays(2)->toDateTimeString());
        $ofACard = ntfUpdate($builds[1], now()->subDay()->toDateTimeString());
        config(['speedclub.home.build_update_rows' => 0]);

        $response = $this->getJson('/api/v1/feed?tab=for_you&per_page=5')->assertOk();

        expect($response->json('data.*.type'))->toBe(['vehicle', 'vehicle', 'vehicle', 'update', 'vehicle'])
            ->and($response->json('data.3.key'))->toBe("update:{$latest->id}")
            ->and($response->json('data.3.update.vehicle.id'))->toBe($elsewhere->id)
            ->and(array_keys($response->json('data.3.update')))->toBe(['id', 'vehicle', 'type_label', 'summary', 'created_at'])
            ->and($response->json('data.3.vehicle'))->toBeNull()
            // Its card shows it as latest_update; it never comes as a row of its own.
            ->and($response->json('data.1.vehicle.latest_update.id'))->toBe($ofACard->id)
            ->and(homeReadFeed('for_you', 30))->not->toContain("update:{$ofACard->id}");
    });

    it('orders builds of equal score by their last change, so long-decayed builds still come newest first', function () {
        $builds = collect([30, 10, 20, 40])->map(fn (int $days) => homeBuild(hoursAgo: 24 * 100 + $days));
        DB::table('vehicle_search')->update(['rank_score' => 0]);
        DB::table('vehicle_search')->whereIn('vehicle_id', [homeBuild()->id, homeBuild()->id])->update(['updated_at' => now()->addHour(), 'rank_score' => -1]);

        expect(homeReadFeed('for_you', 1))->toBe(["vehicle:{$builds[1]->id}", "vehicle:{$builds[2]->id}", "vehicle:{$builds[0]->id}", "vehicle:{$builds[3]->id}"]);
    });

    it('keeps private, unlisted, blocked and hidden owners\' builds out', function () {
        $viewer = User::factory()->create();
        $public = homeBuild();
        homeBuild(attributes: ['visibility' => 'private']);
        homeBuild(attributes: ['visibility' => 'unlisted']);
        homeBuild(User::factory()->suspended()->create());
        $blocked = homeBuild();
        app(BlockMember::class)->handle($blocked->owner, $viewer);
        DB::table('vehicle_search')->update(['updated_at' => now()->subDays(10)]);
        Sanctum::actingAs($viewer);

        // Neue Builds takes two; with the hero off, a stream of the rest.
        $all = [...$this->getJson('/api/v1/home/new-builds?per_page=2')->json('data.*.id'), ...array_map(fn (string $key) => substr($key, 8), homeReadFeed('for_you', 20))];

        expect($all)->toBe([$public->id]);
    });

    it('refuses a forged, cut or foreign cursor and bad parameters with 422', function (string $query, string $field) {
        homeBuild();

        $this->getJson("/api/v1/feed?$query")->assertUnprocessable()->assertJsonPath('code', 'validation_failed')->assertJsonValidationErrors($field);
    })->with([
        'no tab' => ['', 'tab'],
        'unknown tab' => ['tab=trending', 'tab'],
        'per_page 0' => ['tab=for_you&per_page=0', 'per_page'],
        'per_page 31' => ['tab=for_you&per_page=31', 'per_page'],
        'garbage' => ['tab=for_you&cursor=kaputt', 'cursor'],
        'a Laravel cursor' => ['tab=for_you&cursor='.base64_encode('{"at":"2026-11-01 00:00:00","id":"x","_pointsToNextItems":true}'), 'cursor'],
        'unsigned state' => [fn () => 'tab=for_you&cursor='.explode('.', StreamCursor::encode(new StreamState))[0], 'cursor'],
    ]);

    it('answers 304 to the same ETag', function () {
        homeBuild();
        $etag = $this->getJson('/api/v1/feed?tab=for_you')->headers->get('ETag');

        $this->getJson('/api/v1/feed?tab=for_you', ['If-None-Match' => (string) $etag])->assertStatus(304);
    });

    it('answers everybody but a deactivated viewer the same way, minus blocks', function (Closure $who) {
        homeBuild();
        socActAs($who());

        $this->getJson('/api/v1/feed?tab=for_you')->assertOk();
    })->with([
        'guest' => [fn () => null],
        'member' => [fn () => User::factory()->create()],
        'unverified member' => [fn () => User::factory()->unverified()->create()],
        'restricted member' => [fn () => User::factory()->restrictedFrom(RestrictionType::Publishing)->create()],
        'deactivated member' => [fn () => User::factory()->deactivated()->create()],
    ]);
});

describe('tab=following', function () {
    beforeEach(function () {
        $this->viewer = ntfMember('lukas.sc');
        $this->lena = ntfMember('lena.911');
        socFollow($this->viewer, $this->lena);
    });

    it('lists first publishes and visible updates of followed members, newest first', function () {
        $older = homeBuild($this->lena, attributes: ['published_at' => now()->subDays(5)]);
        $newer = homeBuild($this->lena, attributes: ['published_at' => now()->subDays(1)]);
        $update = ntfUpdate($older, now()->subDays(2)->toDateTimeString());
        ntfUpdate($older, now()->subHours(3)->toDateTimeString(), hidden: true);
        homeBuild($this->lena, attributes: ['visibility' => 'private', 'published_at' => now()]);
        homeBuild(ntfMember('fremd'), attributes: ['published_at' => now()]);
        Sanctum::actingAs($this->viewer);

        $response = $this->getJson('/api/v1/feed?tab=following')->assertOk();

        expect($response->json('data.*.key'))->toBe(["vehicle:{$newer->id}", "update:{$update->id}", "vehicle:{$older->id}"])
            ->and($response->json('data.1.update.vehicle.id'))->toBe($older->id)
            ->and($response->json('meta.suggestions'))->toBeNull();
    });

    it('pages by cursor without gaps or repeats', function () {
        $vehicle = homeBuild($this->lena, attributes: ['published_at' => now()->subDays(10)]);
        $ids = collect(range(1, 5))->map(fn (int $i) => ntfUpdate($vehicle, now()->subDays($i)->toDateTimeString())->id);
        Sanctum::actingAs($this->viewer);

        expect(homeReadFeed('following', 2))->toBe([...$ids->map(fn (string $id) => "update:$id")->all(), "vehicle:{$vehicle->id}"]);
    });

    it('leaves out a followed member who blocked the viewer or was suspended', function () {
        homeBuild($this->lena);
        $kenji = ntfMember('kenji.r34');
        socFollow($this->viewer, $kenji);
        homeBuild($kenji);
        app(BlockMember::class)->handle($kenji, $this->viewer);
        $this->lena->forceFill(['status' => 'suspended'])->save();
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/feed?tab=following')->assertOk()->assertJsonCount(0, 'data');
    });

    it('suggests members with a similar car first when empty, never the viewer, followed or hidden members', function () {
        $catalog = homeBuild($this->viewer);
        $sameModel = homeBuild(ntfMember('anna.m4'), attributes: ['make_id' => $catalog->make_id, 'model_id' => $catalog->model_id, 'generation_id' => $catalog->generation_id]);
        $other = homeBuild(ntfMember('paul.roadster'), hoursAgo: 0.5);
        homeBuild(ntfMember('versteckt', ['discoverable' => false]));
        homeBuild(ntfMember('anonym', ['show_owner_on_qr' => false]));
        homeBuild(ntfMember('alt'), hoursAgo: 24 * 30);
        // Lena is followed and has nothing visible: the feed is empty.
        Sanctum::actingAs($this->viewer);

        $response = $this->getJson('/api/v1/feed?tab=following')->assertOk();

        expect($response->json('data'))->toBe([])
            ->and($response->json('meta.suggestions.*.username'))->toBe(['anna.m4', 'paul.roadster'])
            ->and($response->json('meta.suggestions.0'))->toMatchArray(['is_following' => false])
            ->and($response->json('meta.suggestions.0.car_line'))->toBe(app(VehiclePresenter::class)->fullTitle($sameModel->fresh(['make', 'vehicleModel', 'generation'])))
            ->and($other)->not->toBeNull();
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        socActAs($who());

        $this->getJson('/api/v1/feed?tab=following&cursor=kaputt')->assertStatus($status);
    })->with([
        'guest, before validation' => [fn () => null, 401],
        'deactivated member, before validation' => [fn () => User::factory()->deactivated()->create(), 403],
        'member' => [fn () => User::factory()->create(), 422],
    ]);

    it('answers members of every other state', function (Closure $who) {
        socActAs($who());

        $this->getJson('/api/v1/feed?tab=following')->assertOk();
    })->with([
        'member' => [fn () => User::factory()->create()],
        'unverified member' => [fn () => User::factory()->unverified()->create()],
        'member restricted from publishing' => [fn () => User::factory()->restrictedFrom(RestrictionType::Publishing)->create()],
        'member restricted from messaging' => [fn () => User::factory()->restrictedFrom(RestrictionType::Messaging)->create()],
    ]);
});
