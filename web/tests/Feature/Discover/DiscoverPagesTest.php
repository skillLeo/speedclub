<?php

use App\Enums\UserStatus;
use App\Models\DiscoverCollection;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Discover\SearchFilterResolver;
use App\Services\Search\VehicleSearchProjector;
use Database\Seeders\CatalogSeeder;
use Database\Seeders\CollectionSeeder;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DiscoverM23Helpers.php';

/**
 * M2.3 DISC-01 additions, DISC-03 make pages, DISC-04 model pages, builds and wheel setups (m2.3 contract §5, §6).
 */
beforeEach(function () {
    seedModSchema();
    $this->withHeader('Accept-Language', 'de');
});

describe('DISC-03 make pages', function () {
    it('lists models and generations with real counts, most builds first', function () {
        m23Catalog('BMW', 'M4', 'G82', 2021);
        m23Catalog('BMW', 'M4', 'F82', 2014);
        m23Catalog('BMW', 'Z8', 'E52');
        m23Build('BMW', 'M4', 'G82');
        m23Build('BMW', 'M4', 'F82');
        m23Build('BMW', 'M4', 'F82');
        m23Build('BMW', 'M2', null);
        m23Build('BMW', 'M3', 'E46', ['visibility' => 'private']);

        $this->getJson('/api/v1/discover/makes/bmw')->assertOk()
            ->assertJsonPath('data.make.name', 'BMW')
            ->assertJsonPath('data.make.vehicle_count', 4)
            ->assertJsonCount(2, 'data.models')
            ->assertJsonPath('data.models.0.key', 'bmw--m4')
            ->assertJsonPath('data.models.0.vehicle_count', 3)
            ->assertJsonPath('data.models.0.generations', [
                ['name' => 'F82', 'slug' => 'f82', 'year_from' => 2014, 'year_to' => null, 'vehicle_count' => 2],
                ['name' => 'G82', 'slug' => 'g82', 'year_from' => 2021, 'year_to' => null, 'vehicle_count' => 1],
            ])
            ->assertJsonPath('data.models.1.name', 'M2')
            ->assertJsonPath('data.models.1.generations', []);
    });

    it('has no page for a make without a visible build, nor for an unknown one', function () {
        m23Build('Lancia', 'Delta', 'HF Integrale', ['visibility' => 'private']);

        $this->getJson('/api/v1/discover/makes/lancia')->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->getJson('/api/v1/discover/makes/trabbi')->assertNotFound()->assertJsonPath('code', 'not_found');
    });

    it('counts without blocked builds, for a member', function () {
        $viewer = User::factory()->create();
        m23Build('BMW', 'M4', 'G82');
        $blocked = m23Build('BMW', 'M2', 'G87');
        m23Block($blocked->owner, $viewer);
        Sanctum::actingAs($viewer);

        $this->getJson('/api/v1/discover/makes/bmw')->assertOk()
            ->assertJsonPath('data.make.vehicle_count', 1)
            ->assertJsonCount(1, 'data.models');
    });
});

describe('DISC-04 model pages', function () {
    it('reads the header by the key make--model', function () {
        m23Build('BMW', 'M4', 'G82');
        m23Build('BMW', 'M3', 'E46');
        // Another make with the same model slug.
        m23Build('Ford', 'GT', null);
        m23Build('Lamborghini', 'GT', null);

        $this->getJson('/api/v1/discover/models/bmw--m4')->assertOk()
            ->assertJsonPath('data.model', ['id' => VehicleModel::query()->where('slug', 'm4')->value('id'), 'name' => 'M4', 'slug' => 'm4', 'key' => 'bmw--m4', 'vehicle_count' => 1])
            ->assertJsonPath('data.make.vehicle_count', 2)
            ->assertJsonPath('data.generations.0.slug', 'g82');
        $this->getJson('/api/v1/discover/models/ford--gt')->assertOk()->assertJsonPath('data.make.name', 'Ford');
    });

    it('answers 404 for a key that names no model or one without builds', function (string $key) {
        m23Build('BMW', 'M4', 'G82');
        m23Catalog('BMW', 'Z8', 'E52');

        $this->getJson('/api/v1/discover/models/'.$key)->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->getJson('/api/v1/discover/models/'.$key.'/builds')->assertStatus(in_array($key, ['bmw--z8'], true) ? 200 : 404);
    })->with(['m4', 'bmw-m4', 'audi--m4', 'bmw--z8', 'bmw--m4--x', '--m4']);

    it('lists the builds of a model and of one generation, sorted, paged by cursor', function () {
        $g82 = m23Build('BMW', 'M4', 'G82', ['power' => 510, 'published_at' => '2026-01-01 10:00:00']);
        $f82 = m23Build('BMW', 'M4', 'F82', ['power' => 431, 'published_at' => '2026-02-01 10:00:00']);
        $g82b = m23Build('BMW', 'M4', 'G82', ['power' => 550, 'published_at' => '2026-03-01 10:00:00']);
        m23Build('BMW', 'M3', 'E46');

        $ids = fn (string $url) => m23Ids($this->getJson($url)->assertOk()->json('data'));

        expect($ids('/api/v1/discover/models/bmw--m4/builds'))->toBe([$g82b->id, $f82->id, $g82->id])
            ->and($ids('/api/v1/discover/models/bmw--m4/builds?sort=power'))->toBe([$g82b->id, $g82->id, $f82->id])
            ->and($ids('/api/v1/discover/models/bmw--m4/builds?generation=g82'))->toBe([$g82b->id, $g82->id]);

        $first = $this->getJson('/api/v1/discover/models/bmw--m4/builds?per_page=1&sort=power')->assertOk();
        $cursor = $first->json('meta.next_cursor');

        $this->getJson('/api/v1/discover/models/bmw--m4/builds?per_page=1&sort=power&cursor='.$cursor)->assertOk()->assertJsonPath('data.0.id', $g82->id);
        $this->getJson('/api/v1/discover/models/bmw--m4/builds?per_page=1&cursor='.$cursor)->assertUnprocessable()->assertJsonValidationErrors('cursor');
        $this->getJson('/api/v1/discover/models/bmw--m4/builds?per_page=1&sort=power&generation=g82&cursor='.$cursor)->assertUnprocessable()->assertJsonValidationErrors('cursor');
        $this->getJson('/api/v1/discover/models/bmw--m4/wheel-setups?cursor='.$cursor)->assertUnprocessable()->assertJsonValidationErrors('cursor');
        $this->getJson('/api/v1/search/vehicles?make=bmw&model=m4&sort=power&cursor='.$cursor)->assertUnprocessable()->assertJsonValidationErrors('cursor');
    });

    it('validates generation and sort', function (string $query, string $field) {
        m23Build('BMW', 'M4', 'G82');
        m23Catalog('BMW', 'M3', 'E46');

        $this->getJson('/api/v1/discover/models/bmw--m4/builds?'.$query)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        ['generation=e46', 'generation'],
        ['sort=relevance', 'sort'],
        ['per_page=51', 'per_page'],
    ]);

    it('compares wheel setups: one row per build with installed wheels, newest change first, values as stored', function () {
        $square = m23Build('BMW', 'M4', 'G82', ['updated_at' => '2026-01-01 10:00:00'], [
            ['wheels_tires', ['diameter' => 19, 'width_front' => 9.5, 'et_front' => 35, 'tyre_size_front' => '255/35 R19', 'wheel_model' => 'CH-R'], 'BBS'],
        ]);
        $staggered = m23Build('BMW', 'M4', 'G82', ['updated_at' => '2026-02-01 10:00:00'], [
            ['wheels_tires', ['diameter' => 19, 'diameter_rear' => 20, 'width_front' => 9.5, 'width_rear' => 10.5, 'et_front' => 30, 'et_rear' => 40, 'tyre_size_front' => '275/35 R19', 'tyre_size_rear' => '285/30 R20', 'spacer_front' => 5, 'spacer_rear' => 10, 'wheel_model' => 'FF04'], 'HRE'],
            ['suspension', ['type' => 'coilover', 'model' => 'V3', 'lowering_front' => 35, 'lowering_rear' => 30], 'KW'],
        ]);
        m23Build('BMW', 'M4', 'G82', [], [['suspension', ['type' => 'coilover'], 'KW']]);
        m23Build('BMW', 'M3', 'E46', [], [['wheels_tires', ['diameter' => 18], 'BBS']]);

        $rows = $this->getJson('/api/v1/discover/models/bmw--m4/wheel-setups')->assertOk()->assertJsonCount(2, 'data')->json('data');

        expect($rows[0]['vehicle']['id'])->toBe($staggered->id)
            ->and($rows[0]['vehicle']['full_title'])->toBe('BMW M4 G82')
            ->and($rows[0]['vehicle']['owner']['username'])->toBe($staggered->owner->username)
            ->and($rows[0]['wheel'])->toBe([
                'brand' => 'HRE', 'model' => 'FF04', 'diameter_front' => 19, 'diameter_rear' => 20, 'width_front' => 9.5, 'width_rear' => 10.5,
                'et_front' => 30, 'et_rear' => 40, 'tyre_front' => '275/35 R19', 'tyre_rear' => '285/30 R20', 'spacers_front' => 5, 'spacers_rear' => 10,
            ])
            ->and($rows[0]['suspension'])->toBe(['type' => 'coilover', 'type_label' => 'Gewindefahrwerk', 'brand' => 'KW', 'model' => 'V3', 'lowering_front' => 35, 'lowering_rear' => 30])
            ->and($rows[1]['vehicle']['id'])->toBe($square->id)
            ->and($rows[1]['wheel']['diameter_rear'])->toBeNull()
            ->and($rows[1]['suspension'])->toBeNull();
    });

    it('leaves private builds out of the table and hides an owner who hides the name', function () {
        $hidden = User::factory()->create(['show_owner_on_qr' => false]);
        m23Build('BMW', 'M4', 'G82', ['owner' => $hidden], [['wheels_tires', ['diameter' => 19], 'BBS']]);
        m23Build('BMW', 'M4', 'G82', ['visibility' => 'unlisted'], [['wheels_tires', ['diameter' => 20], 'BBS']]);

        $this->getJson('/api/v1/discover/models/bmw--m4/wheel-setups')->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.vehicle.owner', null)
            ->assertJsonPath('data.0.wheel.diameter_front', 19);
    });
});

describe('DISC-01 additions', function () {
    it('lists collections with real counts and a visible cover, leaving out empty and broken ones', function () {
        $m4 = m23Build('BMW', 'M4', 'G82', ['power' => 510]);
        $m2 = m23Build('BMW', 'M2', 'G87', ['power' => 460, 'updated_at' => now()->addMinute()->toDateTimeString()]);
        m23Build('BMW', 'M3', 'E46', ['power' => 343]);
        DiscoverCollection::factory()->create(['key' => 'bmw-m', 'title' => ['de' => 'BMW M Builds', 'en' => 'BMW M builds'], 'subtitle' => ['de' => 'Ab 400 PS', 'en' => 'From 400 PS'], 'filters' => ['make' => 'bmw', 'power_min' => 400], 'sort' => 'power', 'position' => 1, 'cover_vehicle_id' => $m4->id]);
        DiscoverCollection::factory()->create(['key' => 'leer', 'filters' => ['make' => 'bmw', 'power_min' => 900], 'position' => 2]);
        DiscoverCollection::factory()->create(['key' => 'kaputt', 'filters' => ['make' => 'trabbi'], 'position' => 3]);
        DiscoverCollection::factory()->create(['key' => 'aus', 'filters' => ['make' => 'bmw'], 'active' => false, 'position' => 4]);
        DiscoverCollection::factory()->create(['key' => 'alle', 'filters' => [], 'position' => 5]);

        $collections = $this->getJson('/api/v1/discover')->assertOk()->json('data.collections');

        expect(array_column($collections, 'key'))->toBe(['bmw-m', 'alle'])
            ->and($collections[0])->toMatchArray(['title' => 'BMW M Builds', 'subtitle' => 'Ab 400 PS', 'filters' => ['make' => 'bmw', 'power_min' => 400], 'sort' => 'power', 'count' => 2, 'count_capped' => false])
            ->and($collections[0]['cover']['id'])->toBe($m4->cover_media_id ?? Media::query()->where('mediable_id', $m4->id)->value('id'))
            ->and($collections[1]['count'])->toBe(3)
            ->and($collections[1]['filters'])->toBe([]);

        // The chosen build goes private: the cover falls back to the collection's build changed last.
        Vehicle::query()->whereKey($m4->id)->update(['visibility' => 'private']);
        app(VehicleSearchProjector::class)->rebuild($m4->id);

        $collections = $this->getJson('/api/v1/discover')->assertOk()->json('data.collections');
        expect($collections[0]['count'])->toBe(1)
            ->and($collections[0]['cover']['id'])->toBe(Media::query()->where('mediable_id', $m2->id)->value('id'));

        $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/discover')->assertJsonPath('data.collections.0.title', 'BMW M builds');
    });

    it('seeds collections whose filters all resolve against the real catalogue', function () {
        $this->seed(CatalogSeeder::class);
        $this->seed(CollectionSeeder::class);

        expect(DiscoverCollection::query()->orderBy('position')->pluck('key')->all())->toBe(['bmw-m', 'golf-gti-generationen', 'skyline-gt-r', 'youngtimer', '500-ps', 'allrad-ab-400-ps', 'gewindefahrwerk']);

        $resolver = app(SearchFilterResolver::class);

        foreach (DiscoverCollection::all() as $collection) {
            expect($resolver->resolve($collection->filters)['errors'])->toBe([]);
        }

        // Running it again keeps an admin's edit.
        DiscoverCollection::query()->where('key', 'bmw-m')->update(['position' => 99]);
        $this->seed(CollectionSeeder::class);
        expect(DiscoverCollection::query()->where('key', 'bmw-m')->value('position'))->toBe(99);
    });

    it('shows the popular mods of home/modules', function () {
        $home = $this->getJson('/api/v1/home/modules')->assertOk()->json('data.popular_mods');

        $this->getJson('/api/v1/discover')->assertOk()->assertJsonPath('data.popular_mods', $home);
    });

    it('suggests members with similar cars to a member with a public build, flag on', function () {
        m23Flag(true);
        $viewer = User::factory()->create();
        m23Build('BMW', 'M4', 'G82', ['owner' => $viewer]);
        $sameModel = User::factory()->create(['username' => 'same.model']);
        m23Build('BMW', 'M4', 'F82', ['owner' => $sameModel, 'updated_at' => '2026-01-01 10:00:00']);
        $sameMake = User::factory()->create(['username' => 'same.make']);
        m23Build('BMW', 'M2', 'G87', ['owner' => $sameMake, 'updated_at' => '2026-05-01 10:00:00']);
        m23Build('BMW', 'M4', 'G82', ['owner' => User::factory()->create(['username' => 'hidden.me', 'discoverable' => false])]);
        m23Build('BMW', 'M4', 'G82', ['owner' => User::factory()->create(['username' => 'no.name', 'show_owner_on_qr' => false])]);
        $blocked = User::factory()->create(['username' => 'blocked.me']);
        m23Build('BMW', 'M4', 'G82', ['owner' => $blocked]);
        m23Block($viewer, $blocked);
        m23Build('Audi', 'RS6', 'C8', ['owner' => User::factory()->create(['username' => 'other.make'])]);

        $this->getJson('/api/v1/discover')->assertOk()->assertJsonPath('data.similar_members', null);

        Sanctum::actingAs($viewer);
        $members = $this->getJson('/api/v1/discover')->assertOk()->json('data.similar_members');

        expect(array_column($members, 'username'))->toBe(['same.model', 'same.make'])
            ->and($members[0]['garage']['line'])->toBe('1 Fahrzeug · BMW');

        m23Flag(false);
        $this->getJson('/api/v1/discover')->assertOk()->assertJsonPath('data.similar_members', null);
    });

    it('has no similar members for a member without a public build', function () {
        m23Flag(true);
        $viewer = User::factory()->create();
        m23Build('BMW', 'M4', 'G82', ['owner' => $viewer, 'visibility' => 'private']);
        m23Build('BMW', 'M4', 'G82');
        Sanctum::actingAs($viewer);

        $this->getJson('/api/v1/discover')->assertOk()->assertJsonPath('data.similar_members', null);
    });
});

describe('VEH-01 similar builds [SIG]', function () {
    it('ranks the same generation, then the same model, then the same make within 20 % power', function () {
        m23Flag(true);
        $base = m23Build('BMW', 'M4', 'G82', ['power' => 500], [['wheels_tires', ['diameter' => 19]], ['suspension', ['type' => 'coilover']]]);
        $sameGenFewMods = m23Build('BMW', 'M4', 'G82', ['power' => 300]);
        $sameGenMods = m23Build('BMW', 'M4', 'G82', ['power' => 300], [['wheels_tires', ['diameter' => 20]], ['suspension', ['type' => 'air']]]);
        $sameModel = m23Build('BMW', 'M4', 'F82', ['power' => 431]);
        $makeClose = m23Build('BMW', 'M3', 'G80', ['power' => 560]);
        m23Build('BMW', 'M2', 'G87', ['power' => 300]);
        m23Build('Audi', 'RS6', 'C8', ['power' => 500]);
        m23Build('BMW', 'M4', 'G82', ['owner' => $base->owner]);
        m23Build('BMW', 'M4', 'G82', ['visibility' => 'private']);

        $ids = m23Ids($this->getJson("/api/v1/vehicles/{$base->id}/similar")->assertOk()->json('data'));

        expect($ids)->toBe([$sameGenMods->id, $sameGenFewMods->id, $sameModel->id, $makeClose->id]);
    });

    it('shows at most two builds of one owner and at most eight', function () {
        m23Flag(true);
        $base = m23Build('BMW', 'M4', 'G82');
        $busy = User::factory()->create();

        foreach (range(1, 3) as $i) {
            m23Build('BMW', 'M4', 'G82', ['owner' => $busy]);
        }

        foreach (range(1, 8) as $i) {
            m23Build('BMW', 'M4', 'G82');
        }

        $rows = $this->getJson("/api/v1/vehicles/{$base->id}/similar")->assertOk()->json('data');

        expect($rows)->toHaveCount(8)
            ->and(collect($rows)->where('owner.username', $busy->username)->count())->toBeLessThanOrEqual(2);
    });

    it('is off with its flag and unavailable where the vehicle page is', function () {
        $base = m23Build('BMW', 'M4', 'G82');
        $private = m23Build('BMW', 'M4', 'G82', ['visibility' => 'private']);
        $unlisted = m23Build('BMW', 'M4', 'G82', ['visibility' => 'unlisted']);
        $viewer = User::factory()->create();

        m23Flag(false);
        $this->getJson("/api/v1/vehicles/{$base->id}/similar")->assertNotFound()->assertJsonPath('code', 'feature_disabled');

        m23Flag(true);
        $this->getJson("/api/v1/vehicles/{$private->id}/similar")->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        $this->getJson('/api/v1/vehicles/01jzzzzzzzzzzzzzzzzzzzzzzz/similar')->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        // An unlisted build has a page, so it has a strip, which lists only public builds.
        $this->getJson("/api/v1/vehicles/{$unlisted->id}/similar")->assertOk()->assertJsonPath('data.0.id', $base->id)->assertJsonCount(1, 'data');

        // The owner sees the strip of their own private build.
        Sanctum::actingAs($private->owner);
        $this->getJson("/api/v1/vehicles/{$private->id}/similar")->assertOk();

        m23Block($base->owner, $viewer);
        Sanctum::actingAs($viewer);
        $this->getJson("/api/v1/vehicles/{$base->id}/similar")->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');

        User::query()->whereKey($unlisted->owner_id)->update(['status' => UserStatus::Suspended->value]);
        $this->getJson("/api/v1/vehicles/{$unlisted->id}/similar")->assertNotFound();
    });

    it('answers ETag and 304', function () {
        m23Flag(true);
        $base = m23Build('BMW', 'M4', 'G82');
        m23Build('BMW', 'M4', 'G82');
        $etag = $this->getJson("/api/v1/vehicles/{$base->id}/similar")->assertOk()->headers->get('ETag');

        $this->withHeader('If-None-Match', (string) $etag)->getJson("/api/v1/vehicles/{$base->id}/similar")->assertStatus(304);
    });
});

describe('VEH-02 Ähnliche suchen', function () {
    it('gives each mod its own filter values', function () {
        $vehicle = m23Build('BMW', 'M4', 'G82', [], [
            ['wheels_tires', ['diameter' => 19.5], 'BBS'],
            ['suspension', ['type' => 'coilover'], 'KW'],
            ['exhaust', [], 'Akrapovič'],
            ['interior', ['part' => 'seats'], 'Recaro'],
        ]);
        $mods = $vehicle->modifications()->orderBy('sort')->get();
        $search = fn (int $index) => $this->getJson("/api/v1/public/vehicles/{$vehicle->slug}/mods/{$mods[$index]->id}")->assertOk()->json('data.search');

        expect($search(0))->toBe(['mod_category' => 'wheels_tires', 'wheel_brand' => 'bbs', 'wheel_diameter' => 19.5, 'suspension_type' => null, 'suspension_brand' => null, 'exhaust_brand' => null])
            ->and($search(1))->toBe(['mod_category' => 'suspension', 'wheel_brand' => null, 'wheel_diameter' => null, 'suspension_type' => 'coilover', 'suspension_brand' => 'kw', 'exhaust_brand' => null])
            ->and($search(2))->toMatchArray(['mod_category' => 'exhaust', 'exhaust_brand' => 'akrapovic'])
            ->and($search(3))->toBe(['mod_category' => 'interior', 'wheel_brand' => null, 'wheel_diameter' => null, 'suspension_type' => null, 'suspension_brand' => null, 'exhaust_brand' => null]);

        // The values find the build.
        expect(m23Search(http_build_query(['wheel_brand' => ['bbs'], 'wheel_diameter' => [19.5]])))->toBe([$vehicle->id]);
    });
});
