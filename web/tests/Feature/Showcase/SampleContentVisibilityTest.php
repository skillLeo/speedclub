<?php

use App\Enums\CannotMessageReason;
use App\Models\DiscoverCollection;
use App\Models\FeatureFlag;
use App\Models\Follow;
use App\Models\Media;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\LandingPage;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Showcase\SampleContent;
use App\Services\Social\MessagingEligibility;
use Database\Seeders\FeatureFlagSeeder;
use Illuminate\Http\Request;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Home/HomeTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

/**
 * M4.2, 09 §8.19 (ADR-412): the flag editorial_samples decides whether sample content (users.is_sample, vehicles.is_sample) reaches
 * any member-facing or public read. Every surface: flag on → the sample shows, flag off → it is absent, or a 404 like a missing item.
 * A real build and member sit next to it in every case, so "absent" never passes because the list is simply empty.
 */
function smpFlag(bool $on): void
{
    FeatureFlag::query()->updateOrCreate(['key' => SampleContent::FLAG], ['enabled' => $on]);
}

/**
 * @return array{real: Vehicle, sample: Vehicle, realOwner: User, sampleOwner: User}
 */
function smpPair(): array
{
    $realOwner = User::factory()->create(['username' => 'echt.fahrer', 'display_name' => 'Echter Fahrer']);
    $sampleOwner = User::factory()->create(['username' => 'beispiel.fahrer', 'display_name' => 'Beispiel Fahrer', 'is_sample' => true]);

    return [
        'real' => homeBuild($realOwner, 2),
        'sample' => homeBuild($sampleOwner, 1, ['is_sample' => true]),
        'realOwner' => $realOwner,
        'sampleOwner' => $sampleOwner,
    ];
}

/**
 * @return list<string>
 */
function smpIds(string $url, string $path = 'data'): array
{
    return array_values(array_map(fn (array $row): string => (string) ($row['id'] ?? $row['vehicle']['id'] ?? $row['username']), test()->getJson($url)->assertOk()->json($path) ?? []));
}

dataset('sample flag', ['flag on' => [true], 'flag off' => [false]]);

describe('FeatureFlagSeeder', function () {
    // The data migration 2026_11_27_130000 already added the row in the test database: these cases start from a host without it.
    beforeEach(fn () => FeatureFlag::query()->where('key', SampleContent::FLAG)->delete());

    it('turns editorial_samples on for local and staging and off in production', function (string $environment, bool $enabled) {
        app()->detectEnvironment(fn () => $environment);

        app(FeatureFlagSeeder::class)->setContainer(app())->__invoke();

        expect(FeatureFlag::query()->where('key', SampleContent::FLAG)->value('enabled'))->toBe($enabled);
    })->with([
        'local' => ['local', true],
        'staging' => ['staging', true],
        'production' => ['production', false],
    ]);

    it('adds the flag to a host that has the others already and keeps an admin change', function () {
        FeatureFlag::query()->create(['key' => 'sig.compare', 'enabled' => false]);
        app()->detectEnvironment(fn () => 'staging');

        app(FeatureFlagSeeder::class)->setContainer(app())->__invoke();
        expect(FeatureFlag::query()->where('key', SampleContent::FLAG)->value('enabled'))->toBeTrue();

        FeatureFlag::query()->where('key', SampleContent::FLAG)->update(['enabled' => false]);
        app(FeatureFlagSeeder::class)->setContainer(app())->__invoke();

        expect(FeatureFlag::query()->where('key', SampleContent::FLAG)->value('enabled'))->toBeFalse()
            ->and(FeatureFlag::query()->where('key', 'sig.compare')->value('enabled'))->toBeFalse();
    });

    it('adds the flag with the update itself: on outside production, off in production, an existing row kept', function (string $environment, bool $enabled) {
        FeatureFlag::query()->where('key', SampleContent::FLAG)->delete();
        $migration = require database_path('migrations/2026_11_27_130000_add_editorial_samples_flag.php');
        $migration->up();
        expect(FeatureFlag::query()->where('key', SampleContent::FLAG)->exists())->toBeFalse(); // a fresh database is the seeder's

        FeatureFlag::query()->create(['key' => 'sig.compare', 'enabled' => true]); // an existing, seeded host
        app()->detectEnvironment(fn () => $environment);

        $migration->up();
        expect(FeatureFlag::query()->where('key', SampleContent::FLAG)->value('enabled'))->toBe($enabled);

        FeatureFlag::query()->where('key', SampleContent::FLAG)->update(['enabled' => ! $enabled]);
        $migration->up();
        expect(FeatureFlag::query()->where('key', SampleContent::FLAG)->value('enabled'))->toBe(! $enabled);
    })->with(['staging' => ['staging', true], 'production' => ['production', false]]);

    it('hides samples when the flag row is missing (a host that never ran the seeder fails closed)', function () {
        $pair = smpPair();

        expect(smpIds('/api/v1/home/new-builds'))->toBe([$pair['real']->id]);
    });
});

describe('lists', function () {
    it('Home: Neue Builds', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();

        expect(smpIds('/api/v1/home/new-builds'))->toBe($on ? [$pair['sample']->id, $pair['real']->id] : [$pair['real']->id]);
    })->with('sample flag');

    it('Home: the featured hero', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();
        config(['speedclub.home.featured_slugs' => [$pair['sample']->slug]]);

        $featured = smpIds('/api/v1/home/featured');

        expect(in_array($pair['sample']->id, $featured, true))->toBe($on);
    })->with('sample flag');

    it('Home: Build-Updates and Aktive Mitglieder', function (bool $on) {
        homeAbove();
        smpFlag($on);
        $pair = smpPair();
        ntfUpdate($pair['real'], now()->subMinutes(30)->toDateTimeString());
        $sampleUpdate = ntfUpdate($pair['sample'], now()->subMinutes(20)->toDateTimeString());

        $modules = test()->getJson('/api/v1/home/modules')->assertOk()->json('data');

        expect(in_array($sampleUpdate->id, array_column($modules['build_updates'], 'id'), true))->toBe($on)
            ->and(in_array('beispiel.fahrer', array_column($modules['active_members'], 'username'), true))->toBe($on)
            ->and(in_array('echt.fahrer', array_column($modules['active_members'], 'username'), true))->toBeTrue();
    })->with('sample flag');

    it('Home: Beliebte Mods count no sample build', function (bool $on) {
        seedModSchema();
        smpFlag($on);
        $samples = [homeBuild(User::factory()->create(['is_sample' => true]), 1, ['is_sample' => true]), homeBuild(User::factory()->create(['is_sample' => true]), 1, ['is_sample' => true])];
        $reals = [homeBuild(), homeBuild()];

        foreach ($samples as $vehicle) {
            modIn($vehicle, 'suspension', [], ['brand_text' => 'Öhlins', 'part_name' => 'Road & Track', 'status' => 'installed', 'created_at' => now()->subHours(5)]);
        }

        foreach ($reals as $vehicle) {
            modIn($vehicle, 'exhaust', [], ['brand_text' => 'Akrapovič', 'part_name' => 'Slip-On', 'status' => 'installed', 'created_at' => now()->subHours(5)]);
        }

        $labels = array_column(test()->getJson('/api/v1/home/modules')->assertOk()->json('data.popular_mods'), 'label');

        expect(in_array('Öhlins Road & Track', $labels, true))->toBe($on)
            ->and($labels)->toContain('Akrapovič Slip-On');
    })->with('sample flag');

    it('Entdecken: vehicle search and member search', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();

        $samples = smpIds('/api/v1/search/vehicles?q='.urlencode((string) $pair['sample']->make?->name));
        $reals = smpIds('/api/v1/search/vehicles?q='.urlencode((string) $pair['real']->make?->name));
        $members = smpIds('/api/v1/search/users?q=fahrer');

        expect(in_array($pair['sample']->id, $samples, true))->toBe($on)
            ->and($reals)->toContain($pair['real']->id)
            ->and(in_array('beispiel.fahrer', $members, true))->toBe($on)
            ->and($members)->toContain('echt.fahrer');
    })->with('sample flag');

    it('Entdecken: the make page and its counts', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();
        $sampleMake = $pair['sample']->make;

        $response = test()->getJson('/api/v1/discover/makes/'.$sampleMake?->slug);
        $real = test()->getJson('/api/v1/discover/makes/'.$pair['real']->make?->slug)->assertOk()->json('data.make.vehicle_count');

        expect($response->status() === 200 ? $response->json('data.make.vehicle_count') : 0)->toBe($on ? 1 : 0)
            ->and($real)->toBe(1);
    })->with('sample flag');

    it('Entdecken: collections count and cover no sample build', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();
        DiscoverCollection::factory()->create(['key' => 'alle', 'filters' => [], 'position' => 1, 'cover_vehicle_id' => $pair['sample']->id]);

        $collection = test()->getJson('/api/v1/discover')->assertOk()->json('data.collections.0');

        expect($collection['count'])->toBe($on ? 2 : 1)
            ->and($collection['cover']['id'])->toBe(Media::query()->where('mediable_id', ($on ? $pair['sample'] : $pair['real'])->id)->value('id'));
    })->with('sample flag');

    it('followers and following of a real member, and their counts', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();
        Follow::query()->insert([
            ['follower_id' => $pair['sampleOwner']->id, 'followee_id' => $pair['realOwner']->id, 'created_at' => now()->subDay()],
            ['follower_id' => $other = User::factory()->create(['username' => 'zweiter.fan'])->id, 'followee_id' => $pair['realOwner']->id, 'created_at' => now()],
            ['follower_id' => $pair['realOwner']->id, 'followee_id' => $pair['sampleOwner']->id, 'created_at' => now()],
        ]);

        $followers = smpIds('/api/v1/public/users/echt.fahrer/followers');
        $following = smpIds('/api/v1/public/users/echt.fahrer/following');
        $stats = test()->getJson('/api/v1/public/users/echt.fahrer')->assertOk()->json('data.stats');

        expect($followers)->toBe($on ? ['zweiter.fan', 'beispiel.fahrer'] : ['zweiter.fan'])
            ->and($following)->toBe($on ? ['beispiel.fahrer'] : [])
            ->and($stats)->toBe(['vehicles' => 1, 'followers' => $on ? 2 : 1, 'following' => $on ? 1 : 0])
            ->and($other)->not->toBeNull();
    })->with('sample flag');
});

describe('pages', function () {
    it('the public vehicle and member API answer 404 like a missing item', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();

        test()->getJson('/api/v1/public/vehicles/'.$pair['sample']->slug)->assertStatus($on ? 200 : 404);
        test()->getJson('/api/v1/public/users/beispiel.fahrer')->assertStatus($on ? 200 : 404);
        test()->getJson('/api/v1/public/users/beispiel.fahrer/vehicles')->assertStatus($on ? 200 : 404);
        test()->getJson('/api/v1/public/vehicles/'.$pair['real']->slug)->assertOk();

        if (! $on) {
            test()->getJson('/api/v1/public/vehicles/'.$pair['sample']->slug)->assertJsonPath('code', 'vehicle_unavailable');
        }
    })->with('sample flag');

    it('the public web pages /v and /u answer the 404 page', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();

        test()->get('/v/'.$pair['sample']->slug)->assertStatus($on ? 200 : 404);
        test()->get('/u/beispiel.fahrer')->assertStatus($on ? 200 : 404);
        test()->get('/v/'.$pair['real']->slug)->assertOk();
    })->with('sample flag');

    it('lets the sample account see its own build with the flag off', function () {
        smpFlag(false);
        $pair = smpPair();
        Sanctum::actingAs($pair['sampleOwner']);

        test()->getJson('/api/v1/public/vehicles/'.$pair['sample']->slug)->assertOk();
        test()->getJson('/api/v1/public/users/beispiel.fahrer')->assertOk();
    });

    it('serves no OG image of a sample while the flag is off', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();
        $file = $pair['sample']->canonicalSlug().'-0123456789abcdef.jpg';

        $served = app(OgImages::class)->serve('v', $file);

        expect($served === null)->toBe(! $on);
    })->with('sample flag');

    it('never lists a sample page in the sitemap: sample pages are noindex', function (bool $on) {
        smpFlag($on);
        $pair = smpPair();

        $xml = app(SitemapWriter::class)->render();

        expect($xml)->toContain('/v/'.$pair['real']->canonicalSlug())
            ->and($xml)->toContain('/u/echt.fahrer')
            ->and($xml)->not->toContain($pair['sample']->canonicalSlug())
            ->and($xml)->not->toContain('beispiel.fahrer');
    })->with('sample flag');
});

describe('API fields', function () {
    beforeEach(fn () => smpFlag(true));

    it('marks samples and the Editorial account and hides every count of a sample', function () {
        $pair = smpPair();
        $pair['sampleOwner']->forceFill(['is_editorial' => true])->save();
        Follow::query()->insert(['follower_id' => $pair['realOwner']->id, 'followee_id' => $pair['sampleOwner']->id, 'created_at' => now()]);

        $sampleMember = test()->getJson('/api/v1/public/users/beispiel.fahrer')->assertOk()->json('data');
        $realMember = test()->getJson('/api/v1/public/users/echt.fahrer')->assertOk()->json('data');
        $vehicle = test()->getJson('/api/v1/public/vehicles/'.$pair['sample']->slug)->assertOk()->json('data');
        $hit = collect(test()->getJson('/api/v1/search/users?q=beispiel')->assertOk()->json('data'))->firstWhere('username', 'beispiel.fahrer');
        $card = collect(test()->getJson('/api/v1/home/new-builds')->assertOk()->json('data'))->firstWhere('id', $pair['sample']->id);

        Sanctum::actingAs($pair['realOwner']);
        $follow = test()->postJson('/api/v1/users/beispiel.fahrer/follow')->json('data');

        expect($sampleMember)->toMatchArray(['is_sample' => true, 'is_editorial' => true, 'stats' => ['vehicles' => null, 'followers' => null, 'following' => null]])
            ->and($realMember)->toMatchArray(['is_sample' => false, 'is_editorial' => false, 'stats' => ['vehicles' => 1, 'followers' => 0, 'following' => 1]])
            ->and($vehicle['is_sample'])->toBeTrue()
            ->and($vehicle['owner'])->toMatchArray(['is_sample' => true, 'is_editorial' => true])
            ->and($card['is_sample'])->toBeTrue()
            ->and($card['owner']['is_editorial'])->toBeTrue()
            ->and($hit['garage']['vehicles'])->toBeNull()
            ->and($hit['garage']['line'])->not->toMatch('/\d/')
            ->and($follow['followers'])->toBeNull();
    });

    it('gives the sample account itself no counts either (auth/me)', function () {
        $pair = smpPair();
        Sanctum::actingAs($pair['sampleOwner']);

        test()->getJson('/api/v1/auth/me')->assertOk()
            ->assertJsonPath('data.is_sample', true)
            ->assertJsonPath('data.stats', ['vehicles' => null, 'followers' => null, 'following' => null]);
    });

    it('carries the ThumbHash of a sample photo on the media resource', function () {
        $pair = smpPair();
        $pair['sample']->media()->first()?->forceFill(['thumbhash' => '1QcSHQRnh493V4dIh4eXh1h4kJUI'])->save();

        $photos = test()->getJson('/api/v1/public/vehicles/'.$pair['sample']->slug)->assertOk()->json('data.photos');

        expect(array_column($photos, 'thumbhash'))->toContain('1QcSHQRnh493V4dIh4eXh1h4kJUI');
    });
});

describe('more reads (review of 3bf1d0c)', function () {
    it('saved builds: a saved sample build stays saved but is left out while the flag is off', function (bool $on) {
        $pair = smpPair();
        $viewer = User::factory()->create();
        Save::query()->create(['user_id' => $viewer->id, 'vehicle_id' => $pair['real']->id]);
        Save::query()->create(['user_id' => $viewer->id, 'vehicle_id' => $pair['sample']->id]);
        smpFlag($on);
        FeatureFlag::query()->updateOrCreate(['key' => 'sig.saved_builds'], ['enabled' => true]);
        Sanctum::actingAs($viewer);

        $ids = smpIds('/api/v1/me/saved');

        expect($ids)->toContain($pair['real']->id)
            ->and(in_array($pair['sample']->id, $ids, true))->toBe($on)
            ->and(Save::query()->where('user_id', $viewer->id)->count())->toBe(2);
    })->with('sample flag');

    it('notifications: a sample actor disappears with the samples', function (bool $on) {
        smpFlag(true);
        $pair = smpPair();
        $viewer = $pair['realOwner'];
        Sanctum::actingAs($pair['sampleOwner']);
        test()->postJson('/api/v1/users/'.$viewer->username.'/follow')->assertSuccessful();
        smpFlag($on);
        Sanctum::actingAs($viewer);

        $body = json_encode(test()->getJson('/api/v1/notifications')->assertOk()->json('data'), JSON_THROW_ON_ERROR);

        expect(str_contains($body, 'beispiel.fahrer'))->toBe($on);
    })->with('sample flag');

    it('messaging: the inbox drops threads with a sample member and nobody can write to one while the flag is off', function (bool $on) {
        msgFlags();
        smpFlag(true);
        $pair = smpPair();
        $viewer = $pair['realOwner'];
        msgStart($pair['sampleOwner'], $viewer);
        smpFlag($on);
        Sanctum::actingAs($viewer);

        $inbox = json_encode(test()->getJson('/api/v1/conversations')->assertOk()->json('data'), JSON_THROW_ON_ERROR);

        expect(str_contains($inbox, 'beispiel.fahrer'))->toBe($on)
            ->and(app(MessagingEligibility::class)->reason($viewer, $pair['sampleOwner']->fresh()))
            ->toBe($on ? null : CannotMessageReason::RecipientClosed);
    })->with('sample flag');

    it('landing page: samples never crowd real builds out of the featured candidates while the flag is off', function () {
        $real = User::factory()->create(['indexable' => true]);
        $sample = User::factory()->create(['indexable' => true, 'is_sample' => true]);
        $realBuild = homeBuild($real, 1);
        foreach (range(1, 6) as $i) {
            homeBuild($sample, 1, ['is_sample' => true]);
        }
        smpFlag(false);

        $featured = app(LandingPage::class)->data(Request::create('/'))['featured'];

        expect($featured === null || str_contains(json_encode($featured, JSON_THROW_ON_ERROR), (string) $realBuild->slug))->toBeTrue()
            ->and($featured === null ? '' : json_encode($featured, JSON_THROW_ON_ERROR))->not->toContain('"is_sample":true');
    });
});
