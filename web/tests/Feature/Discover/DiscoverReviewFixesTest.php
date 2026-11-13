<?php

use App\Enums\BuildUpdateType;
use App\Enums\UserStatus;
use App\Models\Block;
use App\Models\Brand;
use App\Models\BuildUpdate;
use App\Models\DiscoverCollection;
use App\Models\Follow;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\Garage\BuildUpdates;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DiscoverM23Helpers.php';

/**
 * The Laravel items of the M2.3 code review (docs/reports/phase-2/m2.3-review.md): #9 query budget of GET discover, #10 stored collection
 * filters, #14 the visibility cases of facets, collections and similar builds, #16 merged brand slugs, #17 similar members' last change,
 * #20 the newest tie-break, and the latest change in the viewer's language (DQ-290 follow-up).
 */
beforeEach(function () {
    seedModSchema();
    $this->withHeader('Accept-Language', 'de');
});

/**
 * A second build of each kind the facets count: the one the case hides.
 *
 * @return array{0: Vehicle, 1: Vehicle}
 */
function m23VisibilityPair(): array
{
    $visible = m23Build('BMW', 'M4', 'G82', ['year' => 2022, 'power' => 510, 'drivetrain' => 'rear'], [
        ['wheels_tires', ['diameter' => 19], 'BBS'], ['suspension', ['type' => 'coilover'], 'KW'], ['exhaust', [], 'Akrapovič'],
    ]);
    $hidden = m23Build('Audi', 'RS6', 'C8', ['year' => 1999, 'power' => 900, 'drivetrain' => 'all', 'fuel' => 'diesel'], [
        ['wheels_tires', ['diameter' => 22, 'diameter_rear' => 23], 'HRE'], ['suspension', ['type' => 'air'], 'Bilstein'], ['exhaust', [], 'Capristo'],
    ]);

    return [$visible, $hidden];
}

/**
 * @return array<string, Closure(Vehicle): ?User>
 */
function m23HidingCases(): array
{
    return [
        'owner blocked the viewer' => function (Vehicle $vehicle): User {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $vehicle->owner_id, 'blocked_id' => $viewer->id]);

            return $viewer;
        },
        'viewer blocked the owner' => function (Vehicle $vehicle): User {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $vehicle->owner_id]);

            return $viewer;
        },
        'owner suspended' => function (Vehicle $vehicle): ?User {
            User::query()->whereKey($vehicle->owner_id)->update(['status' => UserStatus::Suspended->value]);

            return null;
        },
        'owner unverified' => function (Vehicle $vehicle): ?User {
            User::query()->whereKey($vehicle->owner_id)->update(['email_verified_at' => null]);

            return null;
        },
        'draft' => function (Vehicle $vehicle): ?User {
            Vehicle::query()->whereKey($vehicle->id)->update(['status' => 'draft']);
            app(VehicleSearchProjector::class)->rebuild($vehicle->id);

            return null;
        },
        'draft, projection not yet rebuilt' => function (Vehicle $vehicle): ?User {
            Vehicle::query()->whereKey($vehicle->id)->update(['status' => 'draft']);

            return null;
        },
    ];
}

function m23ActAs(?User $viewer): void
{
    if ($viewer instanceof User) {
        Sanctum::actingAs($viewer);
    }
}

describe('facets under every visibility case (review #14)', function () {
    it('counts no group, facet row or range of a hidden build', function (string $case) {
        [, $hidden] = m23VisibilityPair();
        m23ActAs(m23HidingCases()[$case]($hidden));

        $data = $this->getJson('/api/v1/search/facets')->assertOk()->json('data');

        expect($data['total'])->toBe(1)
            ->and(m23Counts($data['makes']))->toBe(['bmw' => 1])
            ->and(m23Counts($data['drivetrain']))->toBe(['rear' => 1])
            ->and(m23Counts($data['fuel']))->toBe(['petrol' => 1])
            // The facet-row groups: diameters of both axles, the three brand lists and the suspension type.
            ->and(m23Counts($data['wheel_diameter']))->toBe(['19' => 1])
            ->and(m23Counts($data['wheel_brand']))->toBe(['bbs' => 1])
            ->and(m23Counts($data['suspension_brand']))->toBe(['kw' => 1])
            ->and(m23Counts($data['exhaust_brand']))->toBe(['akrapovic' => 1])
            ->and(m23Counts($data['suspension_type']))->toBe(['coilover' => 1])
            ->and(m23Counts($data['mod_category']))->toMatchArray(['wheels_tires' => 1, 'suspension' => 1, 'exhaust' => 1])
            // The ranges stop at the visible build: neither 1999 nor 900 PS leaks.
            ->and($data['year'])->toBe(['min' => 2022, 'max' => 2022])
            ->and($data['power'])->toBe(['min' => 510, 'max' => 510]);

        // Asked for by name, a hidden value comes back at 0, never with its count.
        $active = $this->getJson('/api/v1/search/facets?make=audi&wheel_brand[]=hre&wheel_diameter[]=23&suspension_type[]=air')->assertOk()->json('data');

        expect($active['total'])->toBe(0)
            ->and(m23Counts($active['makes']))->toBe(['audi' => 0])
            ->and(m23Counts($active['wheel_brand']))->toBe(['hre' => 0])
            ->and(m23Counts($active['wheel_diameter']))->toBe(['23' => 0])
            ->and(m23Counts($active['suspension_type']))->toBe(['air' => 0])
            ->and($active['year'])->toBeNull()
            ->and($active['power'])->toBeNull();
    })->with(array_keys(m23HidingCases()));
});

describe('collections under blocks and suspended owners (review #14)', function () {
    it('counts and covers a collection with visible builds only', function (string $case) {
        [$visible, $hidden] = m23VisibilityPair();
        DiscoverCollection::factory()->create(['key' => 'alle', 'filters' => [], 'position' => 1, 'cover_vehicle_id' => $hidden->id]);
        DiscoverCollection::factory()->create(['key' => 'audi', 'filters' => ['make' => 'audi'], 'position' => 2]);
        m23ActAs(m23HidingCases()[$case]($hidden));

        $collections = $this->getJson('/api/v1/discover')->assertOk()->json('data.collections');

        expect(array_column($collections, 'key'))->toBe(['alle'])
            ->and($collections[0]['count'])->toBe(1)
            // The chosen cover belongs to the hidden build: the cover comes from a visible one.
            ->and($collections[0]['cover']['id'])->toBe(m23CoverOf($visible));
    })->with(array_keys(m23HidingCases()));
});

describe('similar builds under blocks and suspended owners (review #14)', function () {
    it('never suggests a hidden build, nor its owner as a similar member', function (string $case) {
        m23Flag(true);
        $viewer = User::factory()->create();
        $base = m23Build('BMW', 'M4', 'G82', ['owner' => $viewer, 'power' => 500]);
        $shown = m23Build('BMW', 'M4', 'G82', ['power' => 510]);
        $hidden = m23Build('BMW', 'M4', 'G82', ['power' => 520]);
        $setup = m23HidingCases()[$case];
        $other = $setup($hidden);

        // A case that brings its own viewer blocks between that viewer and the hidden owner; it then owns a build of its own.
        $viewer = $other instanceof User ? $other : $viewer;
        $base = $other instanceof User ? m23Build('BMW', 'M4', 'G82', ['owner' => $other, 'power' => 500]) : $base;
        Sanctum::actingAs($viewer);

        $similar = m23Ids($this->getJson("/api/v1/vehicles/{$base->id}/similar")->assertOk()->json('data'));
        $members = array_column($this->getJson('/api/v1/discover')->assertOk()->json('data.similar_members') ?? [], 'username');

        expect($similar)->toContain($shown->id)->not->toContain($hidden->id)
            ->and($members)->toContain($shown->owner->username)->not->toContain($hidden->owner->username);
    })->with(array_keys(m23HidingCases()));

    it('answers 404 for the similar builds of a build the viewer may not see', function (string $case) {
        m23Flag(true);
        $base = m23Build('BMW', 'M4', 'G82');
        m23Build('BMW', 'M4', 'G82');
        m23ActAs(m23HidingCases()[$case]($base));

        $this->getJson("/api/v1/vehicles/{$base->id}/similar")->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    })->with(['owner blocked the viewer', 'viewer blocked the owner', 'owner suspended', 'owner unverified']);
});

function m23CoverOf(Vehicle $vehicle): ?string
{
    $vehicle->refresh();

    return $vehicle->cover_media_id ?? DB::table('media')->where('mediable_id', $vehicle->id)->value('id');
}

describe('GET discover', function () {
    it('reads the collections in a bounded number of queries (review #9)', function () {
        $count = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            test()->getJson('/api/v1/discover')->assertOk();
            $queries = count(DB::getQueryLog());
            DB::disableQueryLog();

            return $queries;
        };

        foreach (range(1, 8) as $index) {
            DiscoverCollection::factory()->create(['key' => 'c'.$index, 'filters' => ['make' => 'bmw', 'power_min' => 100 + $index], 'position' => $index]);
        }

        m23Build('BMW', 'M4', 'G82', ['power' => 510]);
        $one = $count();

        foreach (range(1, 6) as $index) {
            m23Build('BMW', 'M3', 'E46', ['power' => 400 + $index]);
        }

        // Per collection: the make lookup, its count and its cover candidates; the schema and the covers' vehicles are read once.
        // M4.8 added three strips of a fixed cost whatever the data: popular models (counts, models, covers, their vehicles), weekend
        // events (list, presenter) and the newest builds (page, vehicles, relations): at most 12 queries more.
        expect($count())->toBe($one)
            ->and($one)->toBeLessThanOrEqual(8 * 3 + 25 + 12);
    });

    it('skips a collection whose stored filters break the parameter rules, and reads an unknown sort as none (review #10)', function () {
        m23Build('BMW', 'M4', 'G82', ['power' => 510]);
        DiscoverCollection::factory()->create(['key' => 'gut', 'filters' => ['make' => 'bmw'], 'position' => 1]);
        DiscoverCollection::factory()->create(['key' => 'skalar', 'filters' => ['drivetrain' => 'rear'], 'position' => 2]);
        DiscoverCollection::factory()->create(['key' => 'zahl', 'filters' => ['power_min' => 'viel'], 'position' => 3]);
        DiscoverCollection::factory()->create(['key' => 'liste', 'filters' => ['make' => ['bmw']], 'position' => 4]);
        DiscoverCollection::factory()->create(['key' => 'felge', 'filters' => ['wheel_diameter' => [19.25]], 'position' => 5]);
        DiscoverCollection::factory()->create(['key' => 'sortiert', 'filters' => [], 'position' => 6]);
        DB::table('collections')->where('key', 'sortiert')->update(['sort' => 'beliebt']);
        DiscoverCollection::factory()->create(['key' => 'leistung', 'filters' => [], 'position' => 7]);
        DB::table('collections')->where('key', 'leistung')->update(['sort' => 'power']);

        $collections = $this->getJson('/api/v1/discover')->assertOk()->json('data.collections');

        expect(array_column($collections, 'key'))->toBe(['gut', 'sortiert', 'leistung'])
            ->and(array_column($collections, 'sort'))->toBe([null, null, 'power']);
    });
});

describe('brands merged into another (review #16)', function () {
    it('lists a merged brand slug once, under the slug the request used', function () {
        m23Build('BMW', 'M4', 'G82', [], [['wheels_tires', ['diameter' => 19], 'BBS']]);
        m23Build('Audi', 'RS6', 'C8', [], [['wheels_tires', ['diameter' => 20], 'HRE']]);
        $bbs = Brand::query()->where('slug', 'bbs')->firstOrFail();
        Brand::query()->create(['slug' => 'bbs-motorsport', 'name' => 'BBS Motorsport', 'merged_into_id' => $bbs->id]);

        $old = $this->getJson('/api/v1/search/facets?wheel_brand[]=bbs-motorsport')->assertOk()->json('data');
        expect(array_column($old['wheel_brand'], 'value'))->toBe(['bbs-motorsport', 'hre'])
            ->and(m23Counts($old['wheel_brand']))->toBe(['bbs-motorsport' => 1, 'hre' => 1])
            ->and($old['total'])->toBe(1);

        $both = $this->getJson('/api/v1/search/facets?wheel_brand[]=bbs-motorsport&wheel_brand[]=bbs')->assertOk()->json('data');
        expect(array_column($both['wheel_brand'], 'value'))->toBe(['bbs', 'hre']);

        $plain = $this->getJson('/api/v1/search/facets?wheel_brand[]=bbs')->assertOk()->json('data');
        expect(array_column($plain['wheel_brand'], 'value'))->toBe(['bbs', 'hre']);
    });

    it('reads the brand a mod points at with what it was merged into, without a query per mod (review #18)', function () {
        $owner = User::factory()->create();
        $vehicle = m23Build('BMW', 'M4', 'G82', ['owner' => $owner], [
            ['wheels_tires', ['diameter' => 19], 'BBS'], ['suspension', ['type' => 'coilover'], 'KW'], ['exhaust', [], 'Akrapovič'],
        ]);
        Sanctum::actingAs($owner);

        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson("/api/v1/vehicles/{$vehicle->id}/mods")->assertOk();
        $brandQueries = collect(DB::getQueryLog())->filter(fn (array $query): bool => str_contains($query['query'], 'from `brands`'))->count();
        DB::disableQueryLog();

        expect($brandQueries)->toBeLessThanOrEqual(2);
    });
});

describe('similar members (review #17)', function () {
    it('orders the model tier by the matching build changed last, not by a later build of the make only', function () {
        m23Flag(true);
        $viewer = User::factory()->create();
        m23Build('BMW', 'M4', 'G82', ['owner' => $viewer]);
        $early = User::factory()->create(['username' => 'early.m4']);
        $late = User::factory()->create(['username' => 'late.m4']);
        m23Build('BMW', 'M4', 'G82', ['owner' => $early, 'updated_at' => now()->subDays(10)]);
        m23Build('BMW', 'M3', 'E46', ['owner' => $early, 'updated_at' => now()->subMinutes(5)]);
        m23Build('BMW', 'M4', 'F82', ['owner' => $late, 'updated_at' => now()->subDays(2)]);
        Sanctum::actingAs($viewer);

        $members = array_column($this->getJson('/api/v1/discover')->assertOk()->json('data.similar_members'), 'username');

        expect($members)->toBe(['late.m4', 'early.m4']);
    });
});

describe('newest (review #20)', function () {
    it('ties by the last change, then the id, as the handover says', function () {
        $published = now()->subDays(3)->startOfSecond();
        $older = m23Build('BMW', 'M4', 'G82', ['published_at' => $published, 'updated_at' => now()->subDays(2)]);
        $newer = m23Build('BMW', 'M3', 'E46', ['published_at' => $published, 'updated_at' => now()->subDay()]);
        $first = m23Build('Audi', 'RS6', 'C8', ['published_at' => now()->subDay()]);
        VehicleSearch::query()->whereKey([$older->id, $newer->id])->toBase()->update(['published_at' => $published]);

        expect(m23Search('sort=newest', 1))->toBe([$first->id, $newer->id, $older->id]);
    });
});

describe('the latest change in the viewer\'s language (DQ-290 follow-up)', function () {
    it('renders a demo entry written in German from its snapshot for an English reader', function () {
        $vehicle = m23Build('BMW', 'M4', 'G82', [], [['suspension', ['type' => 'coilover', 'lowering_front' => 35], 'KW']]);
        $mod = $vehicle->modifications()->firstOrFail();
        BuildUpdate::query()->where('vehicle_id', $vehicle->id)->delete();
        app(BuildUpdates::class)->backdated($mod, BuildUpdateType::ModAdded, now(), ['label' => 'Fahrwerk', 'before' => 'Serie', 'after' => 'KW V3 · −35 mm']);

        $de = $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/home/new-builds')->assertOk()->json('data.0.latest_update');
        $en = $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/home/new-builds')->assertOk()->json('data.0.latest_update');

        expect($de['summary'])->toBe('Fahrwerk: Serie → KW V3 · −35 mm')
            ->and($en['summary'])->not->toContain('Serie')->not->toContain('Fahrwerk')
            ->and($en['summary'])->toStartWith('Suspension: Stock → ')
            ->and($en['type_label'])->toBe('Suspension added');
    });
});

describe('member rows say whether the viewer follows them (DQ-326)', function () {
    it('marks followed members on search/users, the overview and similar members, false for guests and self', function () {
        m23Flag(true);
        $viewer = User::factory()->create(['username' => 'maxim.self']);
        m23Build('BMW', 'M4', 'G82', ['owner' => $viewer]);
        $followed = User::factory()->create(['username' => 'maxim.followed']);
        $other = User::factory()->create(['username' => 'maxim.other']);
        m23Build('BMW', 'M4', 'G82', ['owner' => $followed]);
        m23Build('BMW', 'M4', 'G82', ['owner' => $other]);
        Follow::factory()->create(['follower_id' => $viewer->id, 'followee_id' => $followed->id]);

        $guest = array_column($this->getJson('/api/v1/search/users?q=maxim')->assertOk()->json('data'), 'is_following', 'username');
        expect($guest)->toBe(['maxim.followed' => false, 'maxim.other' => false, 'maxim.self' => false]);

        Sanctum::actingAs($viewer);
        $expected = ['maxim.followed' => true, 'maxim.other' => false];

        expect(array_column($this->getJson('/api/v1/search/users?q=maxim')->assertOk()->json('data'), 'is_following', 'username'))
            ->toBe([...$expected, 'maxim.self' => false])
            ->and(array_column($this->getJson('/api/v1/search?q=maxim')->assertOk()->json('data.members.items'), 'is_following', 'username'))
            ->toBe([...$expected, 'maxim.self' => false])
            ->and(array_column($this->getJson('/api/v1/discover')->assertOk()->json('data.similar_members'), 'is_following', 'username'))
            ->toEqualCanonicalizing($expected);
    });

    it('reads the follow state of a page in one query, however many rows it holds', function () {
        $viewer = User::factory()->create();
        Sanctum::actingAs($viewer);
        $count = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            test()->getJson('/api/v1/search/users?q=maxim&per_page=20')->assertOk();
            $queries = collect(DB::getQueryLog())->filter(fn (array $query): bool => str_contains($query['query'], 'from `follows`'))->count();
            DB::disableQueryLog();

            return $queries;
        };

        User::factory()->create(['username' => 'maxim0']);
        $one = $count();
        User::factory()->count(12)->sequence(fn ($sequence) => ['username' => 'maxim'.($sequence->index + 1)])->create();

        expect($count())->toBe($one)->and($one)->toBeLessThanOrEqual(2);
    });
});
