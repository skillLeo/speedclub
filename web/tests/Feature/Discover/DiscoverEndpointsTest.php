<?php

use App\Enums\BuildUpdateType;
use App\Enums\DoctorLevel;
use App\Enums\ModStatus;
use App\Enums\RestrictionType;
use App\Enums\UserStatus;
use App\Enums\Visibility;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Media;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Doctor\DoctorResult;
use App\Support\Doctor\EnvironmentDoctor;
use Illuminate\Database\MySqlConnection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M1.8: HOME-01, DISC-01 and DISC-02 P1-lite (02_PRODUCT_SPEC §3.7, §3.8, §8). Catalogue names are fixed here, never from the
 * factories' random words, so a query such as "m4" cannot meet a random generation "m41".
 */
function discCatalog(string $make, string $model, ?string $generation): array
{
    $makeRow = Make::query()->firstOrCreate(['slug' => Str::slug($make)], ['name' => $make, 'country' => 'DE']);
    $modelRow = VehicleModel::query()->firstOrCreate(['make_id' => $makeRow->id, 'slug' => Str::slug($model)], ['name' => $model]);
    $generationRow = $generation === null ? null : Generation::query()->firstOrCreate(
        ['model_id' => $modelRow->id, 'slug' => Str::slug($generation)],
        ['name' => $generation, 'year_from' => 1990, 'year_to' => null],
    );

    return ['make_id' => $makeRow->id, 'model_id' => $modelRow->id, 'generation_id' => $generationRow?->id];
}

/**
 * A published, public build with a photo, in vehicle_search.
 *
 * @param  array<string, mixed>  $attributes
 */
function discBuild(string $make, string $model, ?string $generation, ?User $owner = null, array $attributes = []): Vehicle
{
    $vehicle = publishedVehicle($owner ?? User::factory()->create(), [...discCatalog($make, $model, $generation), ...$attributes]);
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    return $vehicle;
}

/**
 * Sets when the build last changed and copies it into the projection.
 */
function discChangedAt(Vehicle $vehicle, string $at): Vehicle
{
    Vehicle::query()->whereKey($vehicle->id)->update(['updated_at' => $at]);
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    return $vehicle->refresh();
}

/**
 * Many builds at once, written straight into users, vehicles and vehicle_search: as many as a plan or a timing needs, in about a
 * second. Each build has an owner of its own unless $owners names them; the newest is the first, a minute apart.
 *
 * @param  list<string>  $owners
 * @return list<string> the vehicle ids
 */
function discBulkBuilds(int $count, bool $public = true, string $keys = ' probe p1 ', array $owners = []): array
{
    $catalog = discCatalog('Probe', 'Probe', 'P1');
    $offset = DB::table('vehicle_search')->count();
    $ids = [];

    foreach (array_chunk(range(1, $count), 100) as $chunk) {
        $users = [];
        $vehicles = [];
        $rows = [];

        foreach ($chunk as $i) {
            if ($owners === []) {
                $user = User::factory()->make();
                $owner = $user->newUniqueId();
                $users[] = [...$user->getAttributes(), 'id' => $owner, 'created_at' => now(), 'updated_at' => now()];
            } else {
                $owner = $owners[$i % count($owners)];
            }

            $vehicle = Vehicle::factory()->published()->make(['owner_id' => $owner, ...$catalog, 'visibility' => $public ? 'public' : 'private']);
            $id = $vehicle->newUniqueId();
            $at = now()->subMinutes($offset + $i)->toDateTimeString();
            $vehicles[] = [...$vehicle->getAttributes(), 'id' => $id, 'published_at' => $at, 'created_at' => $at, 'updated_at' => $at];
            $rows[] = [
                'vehicle_id' => $id, 'owner_id' => $owner, ...$catalog, 'search_text' => 'Probe Probe P1',
                'title_keys' => ' probe p1 ', 'search_keys' => $keys, 'is_public' => $public, 'published_at' => $at, 'updated_at' => $at,
            ];
            $ids[] = $id;
        }

        DB::table('users')->insert($users);
        DB::table('vehicles')->insert($vehicles);
        DB::table('vehicle_search')->insert($rows);
    }

    return $ids;
}

/**
 * @return list<string>
 */
function discIds(mixed $rows): array
{
    return array_values(array_map(fn (array $row): string => $row['vehicle']['id'] ?? $row['id'], $rows ?? []));
}

/**
 * Every list a build can appear in, as ids, for the privacy matrix.
 *
 * @return array<string, list<string>>
 */
function discEverywhere(string $query): array
{
    $test = test();

    return [
        'featured' => discIds($test->getJson('/api/v1/home/featured')->assertOk()->json('data')),
        'new builds' => discIds($test->getJson('/api/v1/home/new-builds?per_page=50')->assertOk()->json('data')),
        'search' => discIds($test->getJson('/api/v1/search?q='.urlencode($query))->assertOk()->json('data.vehicles.items')),
        'search vehicles' => discIds($test->getJson('/api/v1/search/vehicles?q='.urlencode($query))->assertOk()->json('data')),
    ];
}

describe('the privacy matrix of every list', function () {
    it('shows a public build to guests and members alike', function () {
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');

        foreach (discEverywhere('skyline') as $list => $ids) {
            expect(in_array($vehicle->id, $ids, true))->toBeTrue($list);
        }

        Sanctum::actingAs(User::factory()->create());

        foreach (discEverywhere('skyline') as $list => $ids) {
            expect(in_array($vehicle->id, $ids, true))->toBeTrue($list);
        }

        $this->getJson('/api/v1/discover')->assertJsonPath('data.makes.0.name', 'Nissan')->assertJsonPath('data.makes.0.vehicle_count', 1);
    });

    it('never lists a build that is not public', function (Closure $hide) {
        $visible = discBuild('Nissan', 'Skyline GT-R', 'R34');
        $hidden = discBuild('Nissan', 'Skyline GT-R', 'R33');
        $viewer = $hide($hidden);

        if ($viewer instanceof User) {
            Sanctum::actingAs($viewer);
        }

        foreach (discEverywhere('skyline') as $list => $ids) {
            expect(in_array($hidden->id, $ids, true))->toBeFalse($list)
                ->and(in_array($visible->id, $ids, true))->toBeTrue($list);
        }

        // The tile counts what a tap would find.
        $this->getJson('/api/v1/discover')->assertJsonPath('data.makes.0.vehicle_count', 1);
    })->with([
        'unlisted' => [function (Vehicle $vehicle): ?User {
            $vehicle->forceFill(['visibility' => Visibility::Unlisted])->save();
            app(VehicleSearchProjector::class)->rebuild($vehicle->id);

            return null;
        }],
        'private' => [function (Vehicle $vehicle): ?User {
            $vehicle->forceFill(['visibility' => Visibility::Private])->save();
            app(VehicleSearchProjector::class)->rebuild($vehicle->id);

            return null;
        }],
        'private, projection not yet rebuilt' => [function (Vehicle $vehicle): ?User {
            Vehicle::query()->whereKey($vehicle->id)->update(['visibility' => Visibility::Private->value]);

            return null;
        }],
        'unlisted, projection not yet rebuilt' => [function (Vehicle $vehicle): ?User {
            Vehicle::query()->whereKey($vehicle->id)->update(['visibility' => Visibility::Unlisted->value]);

            return null;
        }],
        'draft' => [function (Vehicle $vehicle): ?User {
            Vehicle::query()->whereKey($vehicle->id)->update(['status' => 'draft']);
            app(VehicleSearchProjector::class)->rebuild($vehicle->id);

            return null;
        }],
        'draft, projection not yet rebuilt' => [function (Vehicle $vehicle): ?User {
            Vehicle::query()->whereKey($vehicle->id)->update(['status' => 'draft']);

            return null;
        }],
        'archived, projection not yet rebuilt' => [function (Vehicle $vehicle): ?User {
            Vehicle::query()->whereKey($vehicle->id)->update(['status' => 'archived']);

            return null;
        }],
        'deleted' => [function (Vehicle $vehicle): ?User {
            $vehicle->delete();

            return null;
        }],
        'owner suspended, projection not yet rebuilt' => [function (Vehicle $vehicle): ?User {
            User::query()->whereKey($vehicle->owner_id)->update(['status' => UserStatus::Suspended->value]);

            return null;
        }],
        'owner deactivated' => [function (Vehicle $vehicle): ?User {
            User::query()->whereKey($vehicle->owner_id)->update(['status' => UserStatus::Deactivated->value]);

            return null;
        }],
        'owner deleted' => [function (Vehicle $vehicle): ?User {
            User::query()->whereKey($vehicle->owner_id)->update(['deleted_at' => now()]);

            return null;
        }],
        'owner unverified' => [function (Vehicle $vehicle): ?User {
            User::query()->whereKey($vehicle->owner_id)->update(['email_verified_at' => null]);

            return null;
        }],
        'viewer blocked the owner' => [function (Vehicle $vehicle): User {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $vehicle->owner_id]);

            return $viewer;
        }],
        'owner blocked the viewer' => [function (Vehicle $vehicle): User {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $vehicle->owner_id, 'blocked_id' => $viewer->id]);

            return $viewer;
        }],
    ]);

    it('keeps the builds of an owner under a restriction that is not a suspension', function (Closure $state) {
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34', $state());

        foreach (discEverywhere('skyline') as $list => $ids) {
            expect(in_array($vehicle->id, $ids, true))->toBeTrue($list);
        }
    })->with([
        'restricted from publishing' => [fn (): User => User::factory()->restrictedFrom(RestrictionType::Publishing, now()->addWeek())->create()],
        'restricted from messaging' => [fn (): User => User::factory()->restrictedFrom(RestrictionType::Messaging)->create()],
    ]);

    it('keeps a block from hiding the build from anybody else', function () {
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');
        $blocked = User::factory()->create();
        Block::factory()->create(['blocker_id' => $vehicle->owner_id, 'blocked_id' => $blocked->id]);

        foreach (discEverywhere('skyline') as $list => $ids) {
            expect(in_array($vehicle->id, $ids, true))->toBeTrue($list);
        }
    });

    it('names the owner on cards unless the owner asked not to be named (ADR-148 a)', function () {
        $hidden = User::factory()->create(['show_owner_on_qr' => false]);
        $named = User::factory()->create(['username' => 'lukas.sc', 'city' => 'Stuttgart']);
        $quiet = discBuild('Nissan', 'Skyline GT-R', 'R34', $hidden);
        $loud = discBuild('Nissan', 'Silvia', 'S15', $named);

        $cards = collect($this->getJson('/api/v1/home/new-builds')->assertOk()->json('data'))->keyBy('id');

        expect($cards[$quiet->id]['owner'])->toBeNull()
            ->and($cards[$loud->id]['owner'])->toMatchArray(['username' => 'lukas.sc', 'city' => 'Stuttgart']);

        $search = collect($this->getJson('/api/v1/search/vehicles?q=nissan')->json('data'))->keyBy('id');
        expect($search[$quiet->id]['owner'])->toBeNull();

        Sanctum::actingAs($hidden);
        $own = collect($this->getJson('/api/v1/home/new-builds')->json('data'))->keyBy('id');
        expect($own[$quiet->id]['owner']['username'])->toBe($hidden->username);
    });

    it('takes a staff session and a member who must change the password for a guest, and starts no session (ADR-124)', function () {
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');
        $member = User::factory()->create(['force_password_change' => true]);
        Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $vehicle->owner_id]);

        $guest = $this->getJson('/api/v1/home/new-builds')->assertOk();
        expect($guest->headers->getCookies())->toBe([]);

        $this->actingAs(Staff::factory()->create(), 'staff');
        expect(discIds($this->getJson('/api/v1/home/new-builds')->json('data')))->toContain($vehicle->id);

        Sanctum::actingAs($member);
        // The block is not applied: a flagged member reads public routes as a guest (ADR-137), and sees what a guest sees.
        expect(discIds($this->getJson('/api/v1/home/new-builds')->json('data')))->toContain($vehicle->id);
    });
});

describe('home: featured', function () {
    it('puts the editorial list first, in its order, and fills the rest by completeness, one per owner', function () {
        $editorialB = discBuild('BMW', 'M4', 'G82');
        $editorialA = discBuild('Nissan', 'GT-R', 'R35');
        $complete = discBuild('Toyota', 'Supra', 'A80', attributes: ['color' => 'Weiß', 'description' => 'Aufgebaut seit 2019']);
        // Same owner as the most complete one, so it must not take a second slot.
        discBuild('Toyota', 'Supra', 'A70', $complete->owner, ['color' => 'Rot']);
        $plain = discBuild('Mazda', 'MX-5', 'NA');
        config(['speedclub.home.featured_slugs' => [$editorialA->slug, 'gibt-es-nicht-zzzzzzzz', strtoupper($editorialB->public_id)]]);

        $response = $this->getJson('/api/v1/home/featured')->assertOk();

        expect($response->json('data.*.source'))->toBe(['editorial', 'editorial', 'completeness'])
            ->and(discIds($response->json('data')))->toBe([$editorialA->id, $editorialB->id, $complete->id])
            ->and($response->json('data.0.vehicle.title'))->toBe('GT-R R35')
            ->and($response->json('data.0.vehicle.cover'))->not->toBeNull();

        config(['speedclub.home.featured_slugs' => []]);
        $fallback = discIds($this->getJson('/api/v1/home/featured')->json('data'));

        // The second Supra has the same owner as the first, so it never takes a slot.
        expect($fallback[0])->toBe($complete->id)
            ->and($fallback)->toHaveCount(3)
            ->and($fallback)->toContain($plain->id)
            ->and(Vehicle::query()->whereKey($fallback)->pluck('owner_id')->unique())->toHaveCount(3);
    });

    it('skips an editorial build the viewer may not see, and builds without a photo', function () {
        $named = discBuild('BMW', 'M4', 'G82');
        $photoless = discBuild('Nissan', 'GT-R', 'R35');
        Media::query()->where('mediable_id', $photoless->id)->delete();
        config(['speedclub.home.featured_slugs' => [$named->slug, $photoless->slug]]);

        $viewer = User::factory()->create();
        Block::factory()->create(['blocker_id' => $named->owner_id, 'blocked_id' => $viewer->id]);
        Sanctum::actingAs($viewer);

        expect(discIds($this->getJson('/api/v1/home/featured')->assertOk()->json('data')))->toBe([]);
    });

    it('stays at three slots', function () {
        foreach (['A80', 'A70', 'A90', 'A60', 'A50'] as $generation) {
            discBuild('Toyota', 'Supra', $generation);
        }

        $this->getJson('/api/v1/home/featured')->assertOk()->assertJsonCount(3, 'data');
    });

    it('answers an empty list when nothing is public', function () {
        $this->getJson('/api/v1/home/featured')->assertOk()->assertExactJson(['data' => []]);
    });
});

describe('home: new builds', function () {
    it('lists the build changed last first, with cursor pages that neither repeat nor skip', function () {
        $ids = [];

        foreach (['2026-10-01 10:00:00', '2026-10-03 10:00:00', '2026-10-02 10:00:00', '2026-10-05 10:00:00', '2026-10-04 10:00:00'] as $i => $at) {
            $ids[$at] = discChangedAt(discBuild('Toyota', 'Supra', 'A8'.$i), $at)->id;
        }

        krsort($ids);
        $seen = [];
        $url = '/api/v1/home/new-builds?per_page=2';

        do {
            $page = $this->getJson($url)->assertOk();
            $seen = [...$seen, ...discIds($page->json('data'))];
            $cursor = $page->json('meta.next_cursor');
            $url = '/api/v1/home/new-builds?per_page=2&cursor='.$cursor;
        } while ($cursor !== null);

        expect($seen)->toBe(array_values($ids));
    });

    it('moves a build up when its specs, mods or photos change', function () {
        $old = discChangedAt(discBuild('Toyota', 'Supra', 'A80'), '2026-10-01 10:00:00');
        discChangedAt(discBuild('Mazda', 'MX-5', 'NA'), '2026-10-02 10:00:00');

        app(VehicleSearchProjector::class)->changed($old);
        app(VehicleSearchProjector::class)->rebuild($old->id);

        expect(discIds($this->getJson('/api/v1/home/new-builds')->json('data'))[0])->toBe($old->id);
    });

    it('shows the card, the owner row and the latest visible change, without counts of any kind', function () {
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');
        BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'type' => BuildUpdateType::ModAdded, 'payload' => ['label' => 'Fahrwerk', 'before' => 'Serie', 'after' => 'KW V3'], 'created_at' => now()->subHour()]);
        BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'type' => BuildUpdateType::ModAdded, 'payload' => ['label' => 'Auspuff', 'before' => 'Serie', 'after' => 'HKS'], 'hidden' => true, 'created_at' => now()]);

        $card = $this->getJson('/api/v1/home/new-builds')->assertOk()->json('data.0');

        foreach (['likes', 'like_count', 'views', 'view_count', 'saves_count', 'comments', 'followers'] as $count) {
            expect($card)->not->toHaveKey($count);
        }

        expect($card['latest_update']['summary'])->toContain('KW V3')
            ->and($card['latest_update']['summary'])->not->toContain('HKS')
            ->and($card)->toHaveKeys(['title', 'full_title', 'subline_parts', 'spec_strip', 'cover', 'owner', 'latest_update'])
            // Owner-only parts of the card stay null for others.
            ->and($card['completeness'])->toBeNull()
            ->and($card['qr'])->toBeNull();
    });

    it('validates its page size and cursor', function (string $query) {
        $this->getJson('/api/v1/home/new-builds?'.$query)->assertUnprocessable()->assertJsonPath('code', 'validation_failed');
    })->with([
        'page size 0' => ['per_page=0'],
        'page size 51' => ['per_page=51'],
        'forged cursor' => ['cursor='.rtrim(strtr(base64_encode('{"relevance":3,"_pointsToNextItems":true}'), '+/', '-_'), '=')],
        'cursor with null' => ['cursor='.rtrim(strtr(base64_encode('{"sort_at":null,"id":"x","_pointsToNextItems":true}'), '+/', '-_'), '=')],
        'not a cursor' => ['cursor=abc'],
    ]);
});

describe('discover: make tiles', function () {
    it('counts the public builds per catalogue make, most first, then by name', function () {
        discBuild('BMW', 'M4', 'G82');
        discBuild('BMW', 'M3', 'E46');
        discBuild('Audi', 'RS3', '8Y');
        discBuild('Nissan', 'GT-R', 'R35');
        discBuild('Nissan', 'Silvia', 'S15');
        discBuild('Porsche', '911', '964', attributes: ['visibility' => 'private']);
        $freeText = publishedVehicle(User::factory()->create(), ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Eigenbau', 'model_text' => 'Kit']);
        app(VehicleSearchProjector::class)->rebuild($freeText->id);

        $response = $this->getJson('/api/v1/discover')->assertOk();

        expect($response->json('data.makes'))->toHaveCount(3)
            ->and(array_map(fn (array $tile): array => [$tile['name'], $tile['vehicle_count']], $response->json('data.makes')))
            ->toBe([['BMW', 2], ['Nissan', 2], ['Audi', 1]])
            ->and($response->json('data.makes.0'))->toHaveKeys(['id', 'name', 'slug', 'vehicle_count'])
            ->and($response->json('data.makes.0'))->not->toHaveKey('logo');
    });

    it('counts what the viewer can find, without builds across a block', function () {
        $bmw = discBuild('BMW', 'M4', 'G82');
        discBuild('BMW', 'M3', 'E46');
        $viewer = User::factory()->create();
        Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $bmw->owner_id]);

        $this->getJson('/api/v1/discover')->assertJsonPath('data.makes.0.vehicle_count', 2);

        Sanctum::actingAs($viewer);
        $this->getJson('/api/v1/discover')->assertJsonPath('data.makes.0.vehicle_count', 1);
    });

    it('revalidates with its ETag', function () {
        discBuild('BMW', 'M4', 'G82');
        $etag = $this->getJson('/api/v1/discover')->assertOk()->headers->get('ETag');

        expect($etag)->not->toBeNull();
        $this->getJson('/api/v1/discover', ['If-None-Match' => $etag])->assertStatus(304);
        $this->getJson('/api/v1/home/featured')->assertHeader('ETag');
        $this->getJson('/api/v1/home/new-builds')->assertHeader('ETag');
    });
});

describe('search: relevance', function () {
    beforeEach(function () {
        seedModSchema();
        $this->r34 = discBuild('Nissan', 'Skyline GT-R', 'R34', User::factory()->create(['username' => 'lukas.sc']));
        $this->r35 = discBuild('Nissan', 'GT-R', 'R35');
        $this->m4 = discBuild('BMW', 'M4', 'G82');
        $this->m40i = discBuild('BMW', 'X3', 'M40i');
        $this->e46 = discBuild('BMW', 'M3', 'E46');
        $this->golf = discBuild('Volkswagen', 'Golf GTI', 'VII (5G)', attributes: ['nickname' => 'Daily']);
        modIn($this->golf, 'other', [], ['title' => 'Lenkrad aus einem M4']);
        app(VehicleSearchProjector::class)->rebuild($this->golf->id);
        $this->kenji = User::factory()->create(['username' => 'kenji.r34', 'display_name' => 'Kenji Sato']);
        $this->max = User::factory()->create(['username' => 'max.e46', 'display_name' => 'Max Berger']);
        // Faker's German names could otherwise meet the queries below.
        User::query()->whereNotIn('username', ['kenji.r34', 'max.e46'])->update(['display_name' => null]);
    });

    it('finds "m4" as the model first, a prefix next and a mention in the mods last', function () {
        expect(discIds($this->getJson('/api/v1/search/vehicles?q=m4')->assertOk()->json('data')))
            ->toBe([$this->m4->id, $this->m40i->id, $this->golf->id]);
    });

    it('finds GT-R however it is written', function (string $query) {
        $ids = discIds($this->getJson('/api/v1/search/vehicles?q='.urlencode($query))->assertOk()->json('data'));

        expect($ids)->toHaveCount(2)->toContain($this->r34->id, $this->r35->id);
    })->with(['gtr', 'GTR', 'gt-r', 'GT-R', ' Gt-R ']);

    it('finds a generation code with its make, in any case', function (string $query, string $expected) {
        expect(discIds($this->getJson('/api/v1/search/vehicles?q='.urlencode($query))->assertOk()->json('data')))->toBe([$this->{$expected}->id]);
    })->with([
        'r34' => ['r34', 'r34'],
        'R34' => ['R34', 'r34'],
        'nissan r34' => ['nissan r34', 'r34'],
        'skyline r34' => ['Skyline R34', 'r34'],
        'e46' => ['e46', 'e46'],
        'bmw e46' => ['BMW E46', 'e46'],
        'golf gti 5g' => ['golf gti 5g', 'golf'],
        'nickname' => ['daily', 'golf'],
    ]);

    it('needs every word to match', function () {
        $this->getJson('/api/v1/search/vehicles?q=nissan+m4')->assertOk()->assertJsonCount(0, 'data');
    });

    it('finds members by username, a part of it and the display name', function (string $query, string $expected) {
        expect($this->getJson('/api/v1/search/users?q='.urlencode($query))->assertOk()->json('data.0.username'))->toBe($expected);
    })->with([
        'r34 after the dot' => ['r34', 'kenji.r34'],
        'e46 after the dot' => ['e46', 'max.e46'],
        'username start' => ['kenji', 'kenji.r34'],
        'with @' => ['@max.e46', 'max.e46'],
        'display name' => ['berger', 'max.e46'],
        'case' => ['SATO', 'kenji.r34'],
    ]);

    it('ranks the exact username above a prefix and a display name', function () {
        User::factory()->create(['username' => 'maxi', 'display_name' => 'Ana Lyse']);
        User::factory()->create(['username' => 'otto', 'display_name' => 'Max Otto']);
        User::factory()->create(['username' => 'max', 'display_name' => 'Zed']);

        expect($this->getJson('/api/v1/search/users?q=max')->assertOk()->json('data.*.username'))
            ->toBe(['max', 'max.e46', 'maxi', 'otto']);
    });

    it('gives the overview the counts of both tabs and cursors that continue on the lists', function () {
        config(['speedclub.search.overview_vehicles' => 2]);

        $response = $this->getJson('/api/v1/search?q=bmw')->assertOk()
            ->assertJsonPath('data.query', 'bmw')
            ->assertJsonPath('data.vehicles.count', 3)
            ->assertJsonCount(2, 'data.vehicles.items')
            ->assertJsonPath('data.members.count', 0)
            ->assertJsonPath('data.members.next_cursor', null);

        $rest = $this->getJson('/api/v1/search/vehicles?q=bmw&cursor='.$response->json('data.vehicles.next_cursor'))->assertOk();

        expect([...discIds($response->json('data.vehicles.items')), ...discIds($rest->json('data'))])
            ->toHaveCount(3)->toContain($this->m4->id, $this->m40i->id, $this->e46->id);

        $this->getJson('/api/v1/search?q=r34')->assertJsonPath('data.vehicles.count', 1)->assertJsonPath('data.members.count', 1)
            ->assertJsonPath('data.members.items.0.username', 'kenji.r34');
    });

    it('pages members by cursor', function () {
        User::factory()->count(4)->sequence(fn ($sequence) => ['username' => 'maxim'.$sequence->index])->create();
        $first = $this->getJson('/api/v1/search/users?q=maxim&per_page=3')->assertOk()->assertJsonCount(3, 'data');
        $second = $this->getJson('/api/v1/search/users?q=maxim&per_page=3&cursor='.$first->json('meta.next_cursor'))->assertOk();

        expect([...$first->json('data.*.username'), ...$second->json('data.*.username')])->toBe(['maxim0', 'maxim1', 'maxim2', 'maxim3'])
            ->and($second->json('meta.next_cursor'))->toBeNull();
    });

    it('describes the garage of a member result', function () {
        discBuild('Nissan', 'Skyline GT-R', 'R34', $this->kenji, ['is_main' => true]);
        discBuild('Toyota', 'Supra', 'A80', $this->kenji);
        discBuild('Nissan', 'GT-R', 'R35', $this->kenji);
        discBuild('Mazda', 'RX-7', 'FD', $this->kenji, ['visibility' => 'unlisted']);

        $row = $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/search/users?q=kenji')->assertOk()->json('data.0');

        expect($row['garage'])->toBe(['vehicles' => 3, 'makes' => ['Nissan', 'Toyota'], 'line' => '3 Fahrzeuge · Nissan, Toyota'])
            ->and($row)->toHaveKeys(['username', 'display_name', 'city', 'avatar', 'is_self'])
            ->and($row)->not->toHaveKey('email')
            ->and($row)->not->toHaveKey('status');

        $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/search/users?q=max.e46')
            ->assertJsonPath('data.0.garage.line', 'No vehicles yet');
    });
});

describe('search: who appears', function () {
    it('lists only discoverable, public members, not across a block', function (Closure $state) {
        $hidden = User::factory()->create(['username' => 'kenji.r34']);
        User::factory()->create(['username' => 'kenji.s15']);
        $viewer = $state($hidden);

        if ($viewer instanceof User) {
            Sanctum::actingAs($viewer);
        }

        expect($this->getJson('/api/v1/search/users?q=kenji')->assertOk()->json('data.*.username'))->toBe(['kenji.s15'])
            ->and($this->getJson('/api/v1/search?q=kenji')->json('data.members.count'))->toBe(1);
    })->with([
        'not discoverable' => [function (User $member): ?User {
            $member->forceFill(['discoverable' => false])->save();

            return null;
        }],
        'unverified' => [function (User $member): ?User {
            $member->forceFill(['email_verified_at' => null])->save();

            return null;
        }],
        'suspended' => [function (User $member): ?User {
            $member->forceFill(['status' => UserStatus::Suspended])->save();

            return null;
        }],
        'deactivated' => [function (User $member): ?User {
            $member->forceFill(['status' => UserStatus::Deactivated])->save();

            return null;
        }],
        'deleted' => [function (User $member): ?User {
            $member->delete();

            return null;
        }],
        'viewer blocked the member' => [function (User $member): User {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $member->id]);

            return $viewer;
        }],
        'member blocked the viewer' => [function (User $member): User {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $viewer->id]);

            return $viewer;
        }],
    ]);

    it('keeps the builds of a member who is not discoverable in vehicle search', function () {
        $member = User::factory()->create(['username' => 'kenji.r34', 'discoverable' => false]);
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34', $member);

        expect(discIds($this->getJson('/api/v1/search/vehicles?q=r34')->json('data')))->toBe([$vehicle->id])
            ->and($this->getJson('/api/v1/search/users?q=r34')->json('data'))->toBe([]);
    });

    it('never searches what others may not read: notes and costs', function () {
        seedModSchema();
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');
        modIn($vehicle, 'other', [], ['title' => 'Teil', 'notes' => 'Geheimversteck', 'cost_cents' => 123456]);
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);

        $this->getJson('/api/v1/search/vehicles?q=geheimversteck')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/search/vehicles?q=123456')->assertOk()->assertJsonCount(0, 'data');
    });

    it('marks the viewer\'s own row', function () {
        $me = User::factory()->create(['username' => 'kenji.r34']);
        Sanctum::actingAs($me);

        $this->getJson('/api/v1/search/users?q=kenji')->assertJsonPath('data.0.is_self', true);
    });
});

describe('search: validation', function () {
    it('refuses a query it cannot search for', function (string $query, string $locale, string $message) {
        $this->withHeader('Accept-Language', $locale)->getJson('/api/v1/search?'.$query)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('errors.q.0', $message);
    })->with([
        'missing' => ['', 'de', 'Gib einen Suchbegriff ein, zum Beispiel eine Marke, ein Modell oder einen Benutzernamen.'],
        'empty' => ['q=', 'de', 'Gib einen Suchbegriff ein, zum Beispiel eine Marke, ein Modell oder einen Benutzernamen.'],
        'blank' => ['q=%20%20', 'en', 'Enter a search term, for example a make, a model or a username.'],
        'punctuation only' => ['q=--%21%21', 'de', 'Der Suchbegriff braucht mindestens einen Buchstaben oder eine Ziffer.'],
        'array' => ['q[]=m4', 'de', 'Gib einen Suchbegriff ein, zum Beispiel eine Marke, ein Modell oder einen Benutzernamen.'],
        'too long' => ['q='.str_repeat('a', 101), 'en', 'The search term is too long. Shorten it to 100 characters or fewer.'],
    ]);

    it('refuses bad pages and cursors', function (string $url) {
        $this->getJson($url)->assertUnprocessable()->assertJsonPath('code', 'validation_failed');
    })->with([
        'page size 0' => ['/api/v1/search/vehicles?q=m4&per_page=0'],
        'page size 51' => ['/api/v1/search/users?q=m4&per_page=51'],
        'cursor on the overview' => ['/api/v1/search?q=m4&cursor=abc'],
        'members cursor on vehicles' => ['/api/v1/search/vehicles?q=m4&cursor='.rtrim(strtr(base64_encode('{"relevance":3,"username":"a","_pointsToNextItems":true}'), '+/', '-_'), '=')],
        'vehicles cursor on members' => ['/api/v1/search/users?q=m4&cursor='.rtrim(strtr(base64_encode('{"relevance":3,"sort_at":"2026-01-01 00:00:00","id":"a","_pointsToNextItems":true}'), '+/', '-_'), '=')],
    ]);

    it('treats LIKE wildcards as text and finds nothing for them', function () {
        discBuild('Nissan', 'Skyline GT-R', 'R34');
        User::factory()->create(['username' => 'kenji_r34']);
        User::factory()->create(['username' => 'kenjixr34']);

        $this->getJson('/api/v1/search?q=%25')->assertUnprocessable();
        expect($this->getJson('/api/v1/search/users?q=kenji_')->assertOk()->json('data.*.username'))->toBe(['kenji_r34']);
    });

    it('cuts a long query to six words and finds nothing for words without letters it knows', function () {
        discBuild('Nissan', 'Skyline GT-R', 'R34');

        $this->getJson('/api/v1/search/vehicles?q='.urlencode('nissan skyline gt-r r34 gt r unbekannt'))->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/search?q='.urlencode('日本'))->assertOk()->assertJsonPath('data.vehicles.count', 0);
    });
});

describe('search: limits and SQL', function () {
    it('limits search to 60 a minute per member and per guest address', function () {
        config(['speedclub.rate_limits.search.max' => 2]);
        RateLimits::register();
        [$one, $two] = User::factory()->count(2)->create();

        $this->getJson('/api/v1/search?q=m4')->assertOk();
        $this->getJson('/api/v1/search/vehicles?q=m4')->assertOk();
        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/search/users?q=m4')
            ->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After')
            ->assertJsonPath('message', fn (string $message): bool => str_starts_with($message, 'Zu viele Suchanfragen.'));

        Sanctum::actingAs($one);
        $this->getJson('/api/v1/search?q=m4')->assertOk();
        $this->getJson('/api/v1/search?q=m4')->assertOk();
        $this->getJson('/api/v1/search?q=m4')->assertTooManyRequests();

        Sanctum::actingAs($two);
        $this->getJson('/api/v1/search?q=m4')->assertOk();

        // Home and Discover carry only the read limit of browsing.
        $this->getJson('/api/v1/discover')->assertOk();
    });

    it('holds many members behind one address at the search ceiling, long before the browse ceiling', function () {
        expect(config()->integer('speedclub.rate_limits.search.ip_max'))->toBeGreaterThan(0)
            ->toBeLessThan(config()->integer('speedclub.rate_limits.browse.ip_max'));

        config(['speedclub.rate_limits.search.max' => 2, 'speedclub.rate_limits.search.ip_max' => 4]);
        RateLimits::register();
        [$one, $two, $three] = User::factory()->count(3)->create();

        // Each member has their own 2; a request over that is refused before it counts against the address.
        Sanctum::actingAs($one);
        $this->getJson('/api/v1/search?q=m4')->assertOk();
        $this->getJson('/api/v1/search/vehicles?q=m4')->assertOk();
        $this->getJson('/api/v1/search/users?q=m4')->assertTooManyRequests();

        Sanctum::actingAs($two);
        $this->getJson('/api/v1/search?q=m4')->assertOk();
        $this->getJson('/api/v1/search?q=m4')->assertOk();

        // The third member has searched nothing, yet the address has had its 4.
        Sanctum::actingAs($three);
        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/search?q=m4')->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After')
            ->assertJsonPath('message', fn (string $message): bool => str_starts_with($message, 'Zu viele Suchanfragen.'));

        // Browsing from the same address goes on, and the same member searches on from another address.
        $this->getJson('/api/v1/discover')->assertOk();
        $this->getJson('/api/v1/home/new-builds')->assertOk();
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7'])->getJson('/api/v1/search?q=m4')->assertOk();
    });

    it('runs under the strict MySQL mode and uses nothing a MySQL 8 or MariaDB 10.6 host lacks', function () {
        discBuild('Nissan', 'Skyline GT-R', 'R34', User::factory()->create(['username' => 'kenji.r34']));
        $mode = (string) DB::selectOne('SELECT @@SESSION.sql_mode AS mode')->mode;
        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            $statements[] = $query->sql;
        });

        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/home/featured')->assertOk();
        $this->getJson('/api/v1/home/new-builds')->assertOk();
        $this->getJson('/api/v1/discover')->assertOk();
        $this->getJson('/api/v1/search?q=gt-r+r34')->assertOk();
        $this->getJson('/api/v1/search/users?q=kenji')->assertOk();

        $sql = strtolower(implode("\n", $statements));

        expect($mode)->toContain('ONLY_FULL_GROUP_BY', 'STRICT_TRANS_TABLES')
            ->and($sql)->not->toContain('regexp_replace', 'regexp_like', 'json_table', 'ngram', 'match(', ' against', 'soundex', 'levenshtein', 'returning', 'json_arrayagg')
            // MySQL 8 refuses LIMIT inside an IN subquery.
            ->and(preg_match('/in \(select[^)]*limit/', $sql))->toBe(0);
    });

    it('reads a page in a fixed number of queries, however many builds and members it holds', function () {
        $count = function (string $url): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson($url)->assertOk();
            $queries = count(DB::getQueryLog());
            DB::disableQueryLog();

            return $queries;
        };
        seedModSchema();
        $seed = function (int $from, int $to): void {
            foreach (range($from, $to) as $i) {
                $owner = User::factory()->create(['username' => 'fahrer'.$i]);
                $vehicle = discBuild('Toyota', 'Supra', 'A'.$i, $owner);
                modIn($vehicle, 'other', [], ['title' => 'Teil']);
                BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);
            }
        };
        $urls = ['/api/v1/home/featured', '/api/v1/home/new-builds', '/api/v1/discover', '/api/v1/search?q=supra', '/api/v1/search?q=fahrer', '/api/v1/search/vehicles?q=supra', '/api/v1/search/users?q=fahrer'];

        $seed(1, 3);
        $few = array_map($count, $urls);
        $seed(4, 12);

        expect(array_map($count, $urls))->toBe($few);
    });

    it('fills title_keys and search_keys in the normal form', function () {
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34', attributes: ['nickname' => 'Bayside Blüe']);
        $row = VehicleSearch::query()->findOrFail($vehicle->id);

        expect($row->getAttribute('title_keys'))->toContain(' nissan ', ' skyline ', ' gtr ', ' gt ', ' r ', ' r34 ', ' bayside ', ' bluee ', ' blue ')
            ->and($row->getAttribute('search_keys'))->toStartWith(' ')->toEndWith(' ');
    });
});
/**
 * The M1.8 API review findings: empty page sizes, the order of "Neue Builds" on its index, search keys of existing rows, the read
 * limit of members behind one address, and the bounded cost of a search (SEC-M18-01, SEC-M18-02).
 */
describe('an empty page size means the default', function () {
    it('answers the default page, not an empty one', function (Closure $seed, string $url, int $default) {
        $seed();
        $response = $this->getJson($url)->assertOk()->assertJsonPath('meta.per_page', $default);

        expect($response->json('data'))->not->toBe([]);
    })->with([
        'new builds' => [fn () => discBuild('Nissan', 'Skyline GT-R', 'R34'), '/api/v1/home/new-builds?per_page=', 20],
        'search vehicles' => [fn () => discBuild('Nissan', 'Skyline GT-R', 'R34'), '/api/v1/search/vehicles?q=nissan&per_page=', 20],
        'search members' => [fn () => User::factory()->create(['username' => 'kenji.r34']), '/api/v1/search/users?q=kenji&per_page=', 20],
        'catalogue' => [fn () => discCatalog('Nissan', 'Skyline GT-R', 'R34'), '/api/v1/catalog/makes?per_page=', 200],
    ]);

    it('also on the garage lists', function () {
        $owner = User::factory()->create();
        discBuild('Nissan', 'Skyline GT-R', 'R34', $owner);
        Sanctum::actingAs($owner);

        $this->getJson('/api/v1/me/vehicles?per_page=')->assertOk()->assertJsonPath('meta.per_page', 30)->assertJsonCount(1, 'data');
    });

    it('still refuses 0 and too many', function (string $url) {
        $this->getJson($url)->assertUnprocessable()->assertJsonPath('code', 'validation_failed');
    })->with(['/api/v1/home/new-builds?per_page=0', '/api/v1/search/vehicles?q=m4&per_page=0', '/api/v1/catalog/makes?per_page=0']);
});

describe('neue builds order on the index', function () {
    it('orders and pages on vehicle_search.updated_at itself, read in order from an index, without a filesort', function () {
        // A list the size a host holds, not a dozen rows a cost-based optimizer may as well scan and sort: every build with an
        // owner of its own (so starting from users is no cheaper) and a quarter of the rows not public. InnoDB counts inserted rows
        // in its row estimate at once; ANALYZE TABLE is left out, as it commits implicitly and would end RefreshDatabase's
        // transaction.
        $public = discBulkBuilds(300);
        discBulkBuilds(100, public: false);

        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            if (str_contains($query->sql, 'sort_at')) {
                $statements[] = [$query->sql, $query->bindings];
            }
        });

        $first = $this->getJson('/api/v1/home/new-builds?per_page=5')->assertOk();
        $second = $this->getJson('/api/v1/home/new-builds?per_page=5&cursor='.$first->json('meta.next_cursor'))->assertOk();

        expect($statements)->toHaveCount(2)
            ->and(discIds([...$first->json('data'), ...$second->json('data')]))->toBe(array_slice($public, 0, 10));

        // Engine-independent: the index exists in this column order, and each statement filters its first column by equality
        // and orders by the bare second one, which is what lets any engine read it in order.
        $index = DB::select('SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX', ['vehicle_search', 'vehicle_search_is_public_updated_at_index']);

        expect(array_column($index, 'name'))->toBe(['is_public', 'updated_at']);

        foreach ($statements as [$sql]) {
            expect($sql)->toContain('`vs`.`is_public` = ?')
                ->toContain('`vs`.`updated_at` as `sort_at`')
                ->toMatch('/order by `sort_at` desc, `id` desc limit 6$/');
        }

        // The plan itself, on the engine the suite runs against, in the tabular form: MySQL's explain_format can default to TREE
        // (MySQL 9), which MariaDB does not know, so the format is named only for MySQL.
        $connection = DB::connection();
        $explain = $connection instanceof MySqlConnection && ! $connection->isMaria() ? 'EXPLAIN FORMAT=TRADITIONAL ' : 'EXPLAIN ';

        foreach ($statements as [$sql, $bindings]) {
            $plan = DB::select($explain.$sql, $bindings);

            expect(strtolower($sql))->not->toContain('coalesce')
                ->and($plan[0]->table)->toBe('vs')
                // (is_public, updated_at), or updated_at alone where every row is public: both hand the rows over in order.
                ->and($plan[0]->key)->toBeIn(['vehicle_search_is_public_updated_at_index', 'vehicle_search_updated_at_index'])
                ->and(implode(' ', array_map(fn (object $row): string => (string) $row->Extra, $plan)))->not->toContain('filesort')->not->toContain('temporary');
        }
    });

    it('keeps that order for a signed-in member, with blocks either way, and never sorts', function () {
        // The block check joins blocks once per row; it must not cost the index order. One build is hidden by the member's own
        // block, one by its owner's block of the member.
        $public = discBulkBuilds(300);
        discBulkBuilds(100, public: false);
        $viewer = User::factory()->create();
        $owners = DB::table('vehicles')->whereIn('id', [$public[1], $public[3]])->pluck('owner_id', 'id');
        Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $owners[$public[1]]]);
        Block::factory()->create(['blocker_id' => $owners[$public[3]], 'blocked_id' => $viewer->id]);
        Sanctum::actingAs($viewer);

        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            if (str_contains($query->sql, 'sort_at')) {
                $statements[] = [$query->sql, $query->bindings];
            }
        });

        $first = $this->getJson('/api/v1/home/new-builds?per_page=5')->assertOk();
        $second = $this->getJson('/api/v1/home/new-builds?per_page=5&cursor='.$first->json('meta.next_cursor'))->assertOk();
        $visible = array_values(array_diff($public, [$public[1], $public[3]]));

        expect($statements)->toHaveCount(2)
            ->and(discIds([...$first->json('data'), ...$second->json('data')]))->toBe(array_slice($visible, 0, 10));

        $connection = DB::connection();
        $explain = $connection instanceof MySqlConnection && ! $connection->isMaria() ? 'EXPLAIN FORMAT=TRADITIONAL ' : 'EXPLAIN ';

        foreach ($statements as [$sql, $bindings]) {
            $plan = DB::select($explain.$sql, $bindings);

            expect($plan[0]->table)->toBe('vs')
                ->and($plan[0]->key)->toBeIn(['vehicle_search_is_public_updated_at_index', 'vehicle_search_updated_at_index'])
                ->and(implode(' ', array_map(fn (object $row): string => (string) $row->Extra, $plan)))->not->toContain('filesort')->not->toContain('temporary');
        }
    });

    it('never writes a row without updated_at, also for a vehicle that has none', function () {
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');
        Vehicle::query()->whereKey($vehicle->id)->update(['updated_at' => null, 'published_at' => '2026-09-01 12:00:00']);

        app(VehicleSearchProjector::class)->rebuild($vehicle->id);

        expect(VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('updated_at')?->toDateTimeString())->toBe('2026-09-01 12:00:00');
    });
});

describe('search keys of existing rows', function () {
    it('are stored as ASCII bytes, so LIKE compares bytes', function () {
        $columns = collect(DB::select('SELECT COLUMN_NAME AS name, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?) ORDER BY COLUMN_NAME', ['vehicle_search', 'title_keys', 'search_keys']))
            ->pluck('collation', 'name')->all();

        expect($columns)->toBe(['search_keys' => 'ascii_bin', 'title_keys' => 'ascii_bin']);
    });

    it('are reported by the doctor until they are rebuilt', function () {
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');
        $check = fn (): DoctorResult => collect(app(EnvironmentDoctor::class)->run())->firstOrFail(fn (DoctorResult $result): bool => $result->check === 'Search projection');

        expect($check()->level)->toBe(DoctorLevel::Ok);

        VehicleSearch::query()->whereKey($vehicle->id)->update(['search_keys' => null]);

        expect($check()->level)->toBe(DoctorLevel::Warning)
            ->and($check()->detail)->toContain('1 builds')->toContain('search:rebuild');

        $this->artisan('search:rebuild')->assertSuccessful();

        expect($check()->level)->toBe(DoctorLevel::Ok);
    });
});

describe('the read limit of home, discover and search', function () {
    beforeEach(function () {
        config(['speedclub.rate_limits.browse.max' => 2, 'speedclub.rate_limits.browse.ip_max' => 5]);
        RateLimits::register();
    });

    it('gives each member behind one address a bucket of their own, bounded per address, and each guest address one', function () {
        [$one, $two] = User::factory()->count(2)->create();

        // A guest: 2 per address. The address ceiling has a counter of its own, so it does not count the guest twice.
        $this->getJson('/api/v1/home/new-builds')->assertOk();
        $this->getJson('/api/v1/discover')->assertOk();
        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/home/featured')->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After')
            ->assertJsonPath('message', fn (string $message): bool => str_starts_with($message, 'Zu viele Anfragen.'));

        // Members behind the same address are not held by the guest's bucket, nor by each other's.
        Sanctum::actingAs($one);
        $this->getJson('/api/v1/home/new-builds')->assertOk();
        $this->getJson('/api/v1/home/featured')->assertOk();
        $this->getJson('/api/v1/discover')->assertTooManyRequests();

        // The fifth request from this address meets the ceiling over everybody behind it.
        Sanctum::actingAs($two);
        $this->getJson('/api/v1/home/new-builds')->assertOk();
        $this->getJson('/api/v1/search?q=m4')->assertTooManyRequests();

        // Elsewhere the same member reads on.
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7'])->getJson('/api/v1/discover')->assertOk();
    });

    it('sits on all four lists', function (string $url) {
        $this->getJson($url)->assertOk();
        $this->getJson($url)->assertOk();
        $this->getJson($url)->assertTooManyRequests();
    })->with(['/api/v1/home/featured', '/api/v1/home/new-builds', '/api/v1/discover', '/api/v1/search?q=m4']);
});

describe('bounded search (SEC-M18-01, SEC-M18-02)', function () {
    it('counts the tabs up to the cap and says when there are more', function () {
        config(['speedclub.search.count_cap' => 2]);
        discBuild('BMW', 'M4', 'G82');
        discBuild('BMW', 'M3', 'E46');
        User::factory()->create(['username' => 'bmw.fan']);

        $this->getJson('/api/v1/search?q=bmw')->assertOk()
            ->assertJsonPath('data.vehicles.count', 2)->assertJsonPath('data.vehicles.count_capped', false)
            ->assertJsonPath('data.members.count', 1)->assertJsonPath('data.members.count_capped', false);

        discBuild('BMW', 'X3', 'M40i');
        User::factory()->count(2)->sequence(['username' => 'bmw.e30'], ['username' => 'bmw.e36'])->create();

        $this->getJson('/api/v1/search?q=bmw')->assertOk()
            ->assertJsonPath('data.vehicles.count', 2)->assertJsonPath('data.vehicles.count_capped', true)
            ->assertJsonPath('data.members.count', 2)->assertJsonPath('data.members.count_capped', true);
    });

    it('finds a word of the 150th mod', function () {
        seedModSchema();
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');

        foreach (range(1, 150) as $i) {
            modIn($vehicle, 'other', [], ['title' => $i === 150 ? 'Zielwort Spurverbreiterung' : "Spurverbreiterung Achse n{$i}", 'status' => ModStatus::Installed, 'sort' => $i]);
        }

        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        $keys = (string) VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('search_keys');

        expect(strlen((string) VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('search_text')))->toBeGreaterThan(3000)
            ->and($keys)->toContain(' zielwort ', ' n149 ');
        expect(discIds($this->getJson('/api/v1/search/vehicles?q=zielwort')->assertOk()->json('data')))->toBe([$vehicle->id]);
    });

    it('stops the keys of one build at their limit, words first from what names the car', function () {
        config(['speedclub.search.keys_max_bytes' => 120]);
        seedModSchema();
        $vehicle = discBuild('Nissan', 'Skyline GT-R', 'R34');

        foreach (range(1, 40) as $i) {
            modIn($vehicle, 'other', [], ['title' => "Bauteil{$i}", 'status' => ModStatus::Installed, 'sort' => $i]);
        }

        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        $keys = (string) VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('search_keys');

        expect(strlen($keys))->toBeLessThanOrEqual(120)
            ->and($keys)->toContain(' nissan ', ' skyline ', ' r34 ', ' bauteil1 ')
            ->and($keys)->not->toContain(' bauteil40 ');
    });

    it('bounds what one search reads: counts stop at count_cap + 1, every statement over the keys has a limit', function () {
        config(['speedclub.search.count_cap' => 3]);
        discBulkBuilds(8, keys: ' zqa zqb ');
        User::factory()->count(5)->sequence(fn ($sequence): array => ['username' => 'zqa.m'.$sequence->index])->create();

        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            $statements[] = strtolower($query->sql);
        });
        $reading = function (string $column) use (&$statements): array {
            return array_values(array_filter($statements, fn (string $sql): bool => str_contains($sql, $column.' like ?')));
        };

        $this->getJson('/api/v1/search?q=zqa')->assertOk()
            ->assertJsonPath('data.vehicles.count', 3)->assertJsonPath('data.vehicles.count_capped', true)
            ->assertJsonPath('data.members.count', 3)->assertJsonPath('data.members.count_capped', true);

        $keys = $reading('vs.search_keys');
        $names = $reading('u.username');

        // The overview: one count and one page over the keys, one count and one page over the members.
        expect($keys)->toHaveCount(2)->and($names)->toHaveCount(2);

        foreach ([$keys, $names] as [$count, $page]) {
            [$count, $page] = str_starts_with($count, 'select count(*)') ? [$count, $page] : [$page, $count];

            expect($count)->toStartWith('select count(*)')->toContain(' limit 4)')
                ->and($page)->toMatch('/ limit \d+$/');
        }

        expect($keys[0].$keys[1])->toContain(' limit 11')
            ->and($names[0].$names[1])->toContain(' limit 6');

        $statements = [];
        $this->getJson('/api/v1/search/vehicles?q='.urlencode('zqa zqb').'&per_page=4')->assertOk()->assertJsonCount(4, 'data');

        expect($reading('vs.search_keys'))->toHaveCount(1)
            ->and($reading('vs.search_keys')[0])->toEndWith(' limit 5');

        // What each row costs to read is bounded by the projector: a build with far more words keeps keys_max_bytes, also at the
        // configured default.
        seedModSchema();
        $long = discBuild('Nissan', 'Skyline GT-R', 'R34');

        foreach (range(1, 70) as $i) {
            $title = implode(' ', array_map(fn (int $j): string => 'w'.base_convert((string) ($i * 1000 + $j), 10, 36).'x', range(1, 18)));
            modIn($long, 'other', [], ['title' => $title, 'status' => ModStatus::Installed, 'sort' => $i]);
        }

        app(VehicleSearchProjector::class)->rebuild($long->id);

        expect(strlen((string) VehicleSearch::query()->findOrFail($long->id)->getAttribute('search_keys')))
            ->toBeLessThanOrEqual(config()->integer('speedclub.search.keys_max_bytes'))
            ->toBeGreaterThan(config()->integer('speedclub.search.keys_max_bytes') - 100);
    });

    // A timing, so it only means something on a quiet machine: composer verify leaves the group out, and the phase gate
    // (scripts/verify.ps1) runs it alone against the target engine. The statement shape above pins the cost in every run.
    it('answers a search over 500 public builds at the keys limit in bounded time', function () {
        $cap = config()->integer('speedclub.search.keys_max_bytes');
        $owners = User::factory()->count(25)->create()->pluck('id')->all();
        // What a build can reach: keys_max_bytes of distinct words, and the six searched words only at the very end of each.
        $filler = '';

        for ($i = 0; strlen($filler) < $cap - 60; $i++) {
            $filler .= ' q'.base_convert((string) ($i * 7919 + 104729), 10, 36);
        }

        $keys = substr($filler, 0, $cap - 60).' zqa zqb zqc zqd zqe zqf ';
        discBulkBuilds(500, keys: $keys, owners: $owners);

        expect(strlen($keys))->toBeLessThanOrEqual($cap);

        $time = function (string $url): float {
            $start = hrtime(true);
            $this->getJson($url)->assertOk();

            return (hrtime(true) - $start) / 1e9;
        };

        $time('/api/v1/search?q=warmup');
        $overview = $time('/api/v1/search?q='.urlencode('zqa zqb zqc zqd zqe zqf'));
        $page = $time('/api/v1/search/vehicles?q='.urlencode('zqa zqb zqc zqd zqe zqf').'&per_page=50');
        $miss = $time('/api/v1/search?q=zzzz');

        $this->getJson('/api/v1/search?q='.urlencode('zqa zqb zqc zqd zqe zqf'))->assertJsonPath('data.vehicles.count', 500);

        // Measured alone: 0.55 s, 0.59 s and 0.09 s; before the ASCII keys 2.70 s, 1.74 s and 0.54 s. Room for a loaded machine.
        expect($overview)->toBeLessThan(2.0)
            ->and($page)->toBeLessThan(2.0)
            ->and($miss)->toBeLessThan(0.5);
    })->group('perf');
});
