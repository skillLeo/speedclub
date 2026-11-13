<?php

use App\Actions\Garage\PublishVehicle;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\CatalogRequest;
use App\Models\FeatureFlag;
use App\Models\Make;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\Garage\BuildUpdates;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Units;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GarageTestHelpers.php';

/**
 * The review of M1.6 (code review and SEC-M16-01 to 07): each finding held here, with the stale models and query counts the
 * first round of tests did not have.
 */
beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
});

/**
 * @return list<string>
 */
function queriesOf(Closure $run): array
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    $run();
    DB::disableQueryLog();

    return array_map(fn (array $entry): string => $entry['query'], DB::getQueryLog());
}

function encodedCursor(array $parameters): string
{
    return rtrim(strtr(base64_encode((string) json_encode([...$parameters, '_pointsToNextItems' => true])), '+/', '-_'), '=');
}

describe('hu_au_due', function () {
    beforeEach(function () {
        FeatureFlag::query()->create(['key' => 'sig.hu_au_reminder', 'enabled' => true]);
        $this->vehicle = publishedVehicle($this->owner, ['hu_au_due' => '2027-03-01']);
    });

    it('goes to the owner', function () {
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->assertJsonPath('data.hu_au_due', '2027-03');
    });

    it('stays away from another member', function () {
        Sanctum::actingAs(User::factory()->create());

        $response = $this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->assertJsonPath('data.hu_au_due', null);

        expect($response->getContent())->not->toContain('2027-03');
    });

    it('is on no public route', function () {
        $slug = $this->vehicle->canonicalSlug();

        foreach (["/api/v1/public/vehicles/{$slug}", '/api/v1/public/users/lukas.sc/vehicles'] as $url) {
            $response = $this->getJson($url)->assertOk();

            expect($response->getContent())->not->toContain('2027-03')->not->toContain('hu_au');
        }
    });
});

describe('DELETE users/{name}/follow tells nothing', function () {
    beforeEach(function () {
        $this->owner->forceFill(['username' => 'neuer.name', 'previous_username' => 'alter.name', 'username_changed_at' => now()])->save();
        User::factory()->create()->following()->attach($this->owner->id, ['created_at' => now()]);
    });

    it('lets a member go across a block, in both directions, without the new name or the count', function (Closure $block) {
        $member = User::factory()->create();
        $member->following()->attach($this->owner->id, ['created_at' => now()]);
        $block($member, $this->owner);
        Sanctum::actingAs($member);

        $this->getJson('/api/v1/public/users/alter.name')->assertNotFound();

        $response = $this->deleteJson('/api/v1/users/alter.name/follow')->assertOk();

        expect($response->json('data'))->toBe(['username' => 'alter.name', 'is_following' => false, 'followers' => null])
            ->and($response->getContent())->not->toContain('neuer.name')
            ->and($member->following()->count())->toBe(0);
    })->with([
        'the target blocked the member' => [fn (User $member, User $target) => Block::factory()->create(['blocker_id' => $target->id, 'blocked_id' => $member->id])],
        'the member blocked the target' => [fn (User $member, User $target) => Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $target->id])],
    ]);

    it('answers the same for a suspended member, an unverified one and a name nobody has', function () {
        $suspended = User::factory()->suspended()->create(['username' => 'gesperrt']);
        $unverified = User::factory()->unverified()->create(['username' => 'ungeprueft']);
        $fan = User::factory()->create();
        $fan->following()->attach($suspended->id, ['created_at' => now()]);
        Sanctum::actingAs($fan);

        foreach (['gesperrt', 'ungeprueft', 'niemand'] as $name) {
            $this->deleteJson("/api/v1/users/{$name}/follow")->assertOk()
                ->assertExactJson(['data' => ['username' => $name, 'is_following' => false, 'followers' => null]]);
        }

        expect($fan->following()->count())->toBe(0)
            ->and($unverified->exists)->toBeTrue();
    });

    it('still gives the state of somebody the viewer can see, under the current name', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->deleteJson('/api/v1/users/alter.name/follow')->assertOk()
            ->assertExactJson(['data' => ['username' => 'neuer.name', 'is_following' => false, 'followers' => 1]]);
    });

    it('refuses bytes that are no text before they reach the answer', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->deleteJson('/api/v1/users/%FF/follow')->assertStatus(400);
    });
});

describe('publishing twice', function () {
    it('keeps the main status when a second publish got past the policy on a stale model', function () {
        $draft = completeDraft($this->owner);
        $first = Vehicle::query()->findOrFail($draft->id);
        $second = Vehicle::query()->findOrFail($draft->id);

        app(PublishVehicle::class)->handle($this->owner, $first);
        $publishedAt = $draft->refresh()->getAttribute('published_at');
        $this->travel(5)->minutes();
        app(PublishVehicle::class)->handle($this->owner, $second);

        $draft->refresh();

        expect($draft->is_main)->toBeTrue()
            ->and($draft->status)->toBe(VehicleStatus::Published)
            ->and($draft->getAttribute('published_at')->equalTo($publishedAt))->toBeTrue()
            ->and($draft->qrCodes()->where('status', QrStatus::Active)->count())->toBe(1);
    });

    it('does not bring back a vehicle deleted after the policy looked', function () {
        $draft = completeDraft($this->owner);
        $stale = Vehicle::query()->findOrFail($draft->id);
        Sanctum::actingAs($this->owner);
        $this->deleteJson("/api/v1/vehicles/{$draft->id}")->assertNoContent();

        app(PublishVehicle::class)->handle($this->owner, $stale);

        expect(Vehicle::withTrashed()->findOrFail($draft->id)->status)->toBe(VehicleStatus::Draft)
            ->and(VehicleSearch::query()->whereKey($draft->id)->exists())->toBeFalse();
    });
});

describe('a published vehicle keeps make, model and year', function () {
    beforeEach(function () {
        Sanctum::actingAs($this->owner);
        $this->make = Make::factory()->create();
        $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'make_text' => 'Nissan', 'model_id' => null, 'model_text' => 'Silvia', 'generation_id' => null, 'model_year' => 2001]);
        $this->catalogued = publishedVehicle($this->owner, ['model_year' => 2001]);
    });

    it('refuses to clear them', function (array $body, array $missing) {
        $this->vehicle->refresh();
        $slug = $this->vehicle->slug;

        $response = $this->withHeader('Accept-Language', 'de')->patchJson("/api/v1/vehicles/{$this->vehicle->id}", $body)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed');

        expect(array_keys($response->json('errors')))->toBe($missing);

        $this->vehicle->refresh();

        expect($this->vehicle->getAttribute('make_text'))->toBe('Nissan')
            ->and($this->vehicle->getAttribute('model_text'))->toBe('Silvia')
            ->and($this->vehicle->model_year)->toBe(2001)
            ->and($this->vehicle->slug)->toBe($slug);
    })->with([
        'make_text' => [['make_text' => null], ['make']],
        'make_id' => [['make_id' => null], ['make']],
        'model_text' => [['model_text' => null], ['model']],
        'model_id' => [['model_id' => null], ['model']],
        'model_year' => [['model_year' => null], ['model_year']],
        'all at once' => [['make_text' => null, 'model_text' => null, 'model_year' => null], ['make', 'model', 'model_year']],
    ]);

    it('uses the words of the publish list', function () {
        $this->withHeader('Accept-Language', 'de')->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['model_year' => null])
            ->assertUnprocessable()
            ->assertJsonPath('errors.model_year.0', __('garage.publish_missing.model_year', [], 'de'));
    });

    it('refuses a new make that would take the model along, unless a model comes with it', function () {
        $this->patchJson("/api/v1/vehicles/{$this->catalogued->id}", ['make_id' => $this->make->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['model']);

        $this->patchJson("/api/v1/vehicles/{$this->catalogued->id}", ['make_text' => 'Toyota', 'model_text' => 'Supra'])
            ->assertOk()
            ->assertJsonPath('data.make', 'Toyota')
            ->assertJsonPath('data.model', 'Supra');
    });

    it('lets them change, and leaves other edits of an older entry alone', function () {
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['model_text' => 'Silvia S15', 'model_year' => 2002])->assertOk();

        $older = publishedVehicle($this->owner, ['model_year' => null]);

        $this->patchJson("/api/v1/vehicles/{$older->id}", ['color' => 'Blau'])->assertOk();
    });

    it('lets a draft clear them', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'make_text' => 'Nissan', 'model_year' => 2001]);

        $this->patchJson("/api/v1/vehicles/{$draft->id}", ['make_text' => null, 'model_year' => null])->assertOk();
    });
});

describe('brand and part follow the fields', function () {
    beforeEach(function () {
        Sanctum::actingAs($this->owner);
        $this->vehicle = publishedVehicle($this->owner);
    });

    it('drops what the fields no longer name, and the automatic title with it', function () {
        $id = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'suspension', 'fields' => ['brand' => 'KW', 'model' => 'V3', 'lowering_front' => 35]])
            ->assertCreated()
            ->assertJsonPath('data.title', 'KW V3')
            ->json('data.id');

        $this->withHeader('Accept-Language', 'de')->patchJson("/api/v1/mods/{$id}", ['fields' => ['lowering_front' => 35]])->assertOk()
            ->assertJsonPath('data.title', 'Fahrwerk')
            ->assertJsonPath('data.brand', null)
            ->assertJsonPath('data.brand_id', null)
            ->assertJsonPath('data.brand_text', null)
            ->assertJsonPath('data.part_name', null);
    });

    it('takes them out of search', function () {
        $brandId = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'suspension', 'fields' => ['brand' => 'KW', 'model' => 'V3']])
            ->assertCreated()
            ->json('data.brand_id');
        $id = Modification::query()->where('vehicle_id', $this->vehicle->id)->value('id');

        expect($brandId)->toBeInt();

        $this->patchJson("/api/v1/mods/{$id}", ['fields' => ['lowering_front' => 35]])->assertOk();
        app(VehicleSearchProjector::class)->rebuild($this->vehicle->id);

        $row = VehicleSearch::query()->findOrFail($this->vehicle->id);

        expect($row->getAttribute('suspension_brand_id'))->toBeNull()
            ->and($row->getAttribute('search_text'))->not->toContain('V3');
    });

    it('keeps a title the member wrote', function () {
        $id = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'suspension', 'title' => 'Mein Fahrwerk', 'fields' => ['brand' => 'KW', 'model' => 'V3']])->assertCreated()->json('data.id');

        $this->patchJson("/api/v1/mods/{$id}", ['fields' => ['lowering_front' => 35]])->assertOk()->assertJsonPath('data.title', 'Mein Fahrwerk');
    });

    it('keeps a brand and part set directly when the fields never named them', function () {
        $id = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'suspension', 'brand_text' => 'KW', 'part_name' => 'V3', 'fields' => ['lowering_front' => 35]])->assertCreated()->json('data.id');

        $this->patchJson("/api/v1/mods/{$id}", ['fields' => ['lowering_front' => 40]])->assertOk()
            ->assertJsonPath('data.title', 'KW V3')
            ->assertJsonPath('data.brand_text', 'KW')
            ->assertJsonPath('data.part_name', 'V3');
    });

    it('leaves them alone when fields are not sent', function () {
        $id = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'suspension', 'fields' => ['brand' => 'KW', 'model' => 'V3']])->assertCreated()->json('data.id');

        $this->patchJson("/api/v1/mods/{$id}", ['notes' => 'Text'])->assertOk()->assertJsonPath('data.title', 'KW V3')->assertJsonPath('data.part_name', 'V3');
    });
});

describe('photos in the build history', function () {
    beforeEach(function () {
        $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'published_at' => now()]);
        $this->photos = app(BuildUpdates::class);
        $this->addPhotos = function (int $count): void {
            Media::factory()->forModel($this->vehicle)->count($count)->create(['owner_id' => $this->owner->id, 'created_at' => now()]);
            $this->photos->photoAdded($this->vehicle);
        };
    });

    it('does not count what was uploaded before publishing', function () {
        Media::factory()->forModel($this->vehicle)->count(5)->create(['owner_id' => $this->owner->id, 'created_at' => now()->subMinutes(2)]);
        ($this->addPhotos)(1);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(0);
    });

    it('counts exactly what came after publishing once there are three', function () {
        Media::factory()->forModel($this->vehicle)->count(5)->create(['owner_id' => $this->owner->id, 'created_at' => now()->subMinutes(2)]);
        ($this->addPhotos)(3);

        $update = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->sole();

        expect($update->payload['changes'][0])->toMatchArray(['kind' => 'photos_added', 'count' => 3]);
    });

    it('does not tell again about photos the owner hid', function () {
        ($this->addPhotos)(3);
        $hidden = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->sole();
        $hidden->forceFill(['hidden' => true, 'open_until' => null])->save();

        $this->travel(1)->minutes();
        ($this->addPhotos)(1);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });

    it('does not tell again about photos that joined the entry before it was hidden', function () {
        ($this->addPhotos)(3);
        $this->travel(1)->minutes();
        ($this->addPhotos)(1);
        $hidden = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->sole();

        expect($hidden->payload['changes'][0]['count'])->toBe(4);

        $hidden->forceFill(['hidden' => true, 'open_until' => null])->save();
        $this->travel(1)->minutes();
        ($this->addPhotos)(2);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });

    it('starts over with three new ones after a hidden entry', function () {
        ($this->addPhotos)(3);
        BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->sole()->forceFill(['hidden' => true, 'open_until' => null])->save();

        $this->travel(1)->minutes();
        ($this->addPhotos)(3);

        $latest = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->where('hidden', false)->sole();

        expect($latest->payload['changes'][0]['count'])->toBe(3);
    });

    it('finds an earlier photo entry when another change came first', function () {
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'suspension', 'brand_text' => 'KW', 'part_name' => 'V3', 'fields' => ['lowering_front' => 35]])->assertCreated();
        ($this->addPhotos)(3);
        $entry = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->sole();

        expect($entry->payload['changes'])->toHaveCount(2);

        $entry->forceFill(['hidden' => true, 'open_until' => null])->save();
        $this->travel(1)->minutes();
        ($this->addPhotos)(1);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });

    it('does not count a rejected photo', function () {
        Media::factory()->forModel($this->vehicle)->count(2)->create(['owner_id' => $this->owner->id, 'moderation_status' => ModerationStatus::Rejected, 'created_at' => now()]);
        ($this->addPhotos)(1);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(0);
    });
});

describe('build updates on the page', function () {
    it('asks for the rows it shows and counts apart', function () {
        $vehicle = publishedVehicle($this->owner);
        BuildUpdate::factory()->count(25)->create(['vehicle_id' => $vehicle->id]);
        BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'hidden' => true]);
        $response = null;

        $queries = queriesOf(function () use (&$response, $vehicle): void {
            $response = $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertOk();
        });

        $selects = array_values(array_filter($queries, fn (string $sql): bool => str_contains($sql, 'build_updates')));

        expect($response->json('data.updates_count'))->toBe(25)
            ->and($response->json('data.updates'))->toHaveCount(config()->integer('speedclub.garage.public_updates_on_page'))
            ->and($selects)->toHaveCount(2)
            ->and(array_filter($selects, fn (string $sql): bool => str_contains($sql, 'count(*)')))->toHaveCount(1)
            ->and(array_filter($selects, fn (string $sql): bool => str_contains($sql, 'limit 20')))->toHaveCount(1);
    });

    it('counts hidden entries for the owner only', function () {
        $vehicle = publishedVehicle($this->owner);
        BuildUpdate::factory()->count(2)->create(['vehicle_id' => $vehicle->id]);
        BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'hidden' => true]);

        $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertOk()->assertJsonPath('data.updates_count', 2);

        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertOk()->assertJsonPath('data.updates_count', 3);
    });
});

describe('Viewer', function () {
    it('asks once per request, also for nobody', function () {
        $request = Request::create('/');
        $calls = 0;
        $request->setUserResolver(function () use (&$calls): null {
            $calls++;

            return null;
        });

        expect(Viewer::from($request))->toBeNull()
            ->and(Viewer::from($request))->toBeNull()
            ->and($calls)->toBe(1);
    });

    it('does not read as a member what another request found', function () {
        $first = Request::create('/');
        $first->setUserResolver(fn () => null);
        $second = Request::create('/');
        $second->setUserResolver(fn () => $this->owner);

        expect(Viewer::from($first))->toBeNull()
            ->and(Viewer::from($second)?->id)->toBe($this->owner->id);
    });

    it('still reads a flagged member as a guest', function () {
        $request = Request::create('/');
        $flagged = User::factory()->create(['force_password_change' => true]);
        $request->setUserResolver(fn () => $flagged);

        expect(Viewer::from($request))->toBeNull()->and(Viewer::from($request))->toBeNull();
    });
});

describe('queries do not grow with the rows', function () {
    /**
     * @param  array<string, string>  $headers
     */
    function pageQueries(Vehicle $vehicle, array $headers = []): int
    {
        return count(queriesOf(function () use ($vehicle, $headers): void {
            test()->withHeaders($headers)->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertOk();
        }));
    }

    function fillVehicle(Vehicle $vehicle, int $mods, int $updates): void
    {
        foreach (range(1, $mods) as $i) {
            modIn($vehicle, $i % 2 === 0 ? 'suspension' : 'exhaust', [], ['title' => 'Teil '.$i]);
        }

        BuildUpdate::factory()->count($updates)->create(['vehicle_id' => $vehicle->id]);
    }

    beforeEach(function () {
        $this->few = publishedVehicle($this->owner);
        fillVehicle($this->few, 2, 2);
        $this->many = publishedVehicle($this->owner);
        fillVehicle($this->many, 30, 100);
    });

    it('for a guest', function () {
        $few = pageQueries($this->few);
        $many = pageQueries($this->many);

        // M4.9 added the pinned highlights rail (one query while nothing is pinned): a fixed cost.
        expect($many)->toBe($few)->and($many)->toBeLessThan(31);
    });

    it('for a member', function () {
        Sanctum::actingAs(User::factory()->create());

        expect(pageQueries($this->many))->toBe(pageQueries($this->few));
    });

    it('for the owner', function () {
        Sanctum::actingAs($this->owner);

        expect(pageQueries($this->many))->toBe(pageQueries($this->few));
    });

    it('for an invalid token, which costs one lookup however long the page is', function () {
        $headers = ['Authorization' => 'Bearer 1|'.Str::random(40)];
        $few = pageQueries($this->few, $headers);
        $this->app['auth']->forgetGuards();
        $many = pageQueries($this->many, $headers);
        $this->app['auth']->forgetGuards();

        $tokenQueries = array_filter(queriesOf(function () use ($headers): void {
            $this->withHeaders($headers)->getJson('/api/v1/public/vehicles/'.$this->many->canonicalSlug())->assertOk();
        }), fn (string $sql): bool => str_contains($sql, 'personal_access_tokens'));

        expect($many)->toBe($few)
            ->and(count($tokenQueries))->toBeLessThanOrEqual(3);
    });

    it('on the list of updates, with an invalid token', function () {
        $headers = ['Authorization' => 'Bearer 1|'.Str::random(40)];

        $tokenQueries = array_filter(queriesOf(function () use ($headers): void {
            $this->withHeaders($headers)->getJson('/api/v1/public/vehicles/'.$this->many->canonicalSlug().'/updates?per_page=30')->assertOk();
        }), fn (string $sql): bool => str_contains($sql, 'personal_access_tokens'));

        expect(count($tokenQueries))->toBeLessThanOrEqual(3);
    });

    it('on the garage, with 1 and with 20 vehicles', function () {
        $alone = User::factory()->create();
        publishedVehicle($alone);
        $full = User::factory()->create();

        foreach (range(1, 20) as $i) {
            publishedVehicle($full);
        }

        Sanctum::actingAs($alone);
        $one = count(queriesOf(fn () => $this->getJson('/api/v1/me/vehicles')->assertOk()->assertJsonCount(1, 'data')));

        Sanctum::actingAs($full);
        $twenty = count(queriesOf(fn () => $this->getJson('/api/v1/me/vehicles')->assertOk()->assertJsonCount(20, 'data')));

        expect($twenty)->toBe($one);
    });
});

describe('money', function () {
    it('has two decimals or none', function (int $cents, string $locale, string $label) {
        expect(Units::formatMoney($cents, $locale))->toBe($label);
    })->with([
        [123450, 'de', '1.234,50'],
        [123450, 'en', '1,234.50'],
        [123456, 'de', '1.234,56'],
        [123400, 'de', '1.234'],
        [123400, 'en', '1,234'],
        [5, 'de', '0,05'],
        [0, 'de', '0'],
    ]);

    it('labels the owner\'s cost in the viewer\'s language (M4.9: costs are the owner\'s alone)', function (string $locale, string $label) {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'suspension', [], ['cost_cents' => 123450, 'cost_public' => true]);
        Sanctum::actingAs($this->owner);

        $this->withHeader('Accept-Language', $locale)
            ->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug()."/mods/{$mod->id}")
            ->assertOk()
            ->assertJsonPath('data.cost.label', $label);
    })->with([
        ['de', '1.234,50 €'],
        ['en', '€1,234.50'],
    ]);
});

describe('search projection under the lock', function () {
    it('takes the vehicle\'s row lock inside a transaction, ahead of everything else', function () {
        $vehicle = publishedVehicle($this->owner);
        $levels = [];
        DB::listen(function ($query) use (&$levels): void {
            $levels[] = [$query->sql, DB::transactionLevel()];
        });

        $base = DB::transactionLevel();
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);

        expect($levels[0][0])->toContain('`vehicles`')->toContain('for update')
            ->and($levels[0][1])->toBeGreaterThan($base);
    });

    it('reads the state committed by a privacy change, not the state of the caller\'s model', function () {
        $vehicle = publishedVehicle($this->owner);
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'private'])->assertOk();
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);

        expect(VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('is_public'))->toBeFalse();
    });

    it('does not bring a deleted vehicle back', function () {
        $vehicle = publishedVehicle($this->owner);
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        Sanctum::actingAs($this->owner);

        $this->deleteJson("/api/v1/vehicles/{$vehicle->id}")->assertNoContent();
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);

        expect(VehicleSearch::query()->whereKey($vehicle->id)->exists())->toBeFalse();
    });
});

describe('a rejected photo', function () {
    beforeEach(function () {
        Sanctum::actingAs($this->owner);
        $this->draft = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'model_year' => 2020]);
        $this->rejected = Media::factory()->forModel($this->draft)->create(['owner_id' => $this->owner->id, 'moderation_status' => ModerationStatus::Rejected, 'sort' => 0]);
    });

    it('counts for completeness as little as for publishing', function () {
        $missing = collect($this->getJson("/api/v1/vehicles/{$this->draft->id}")->assertOk()->json('data.completeness.missing'))->pluck('key');

        expect($missing)->toContain('photo');

        $this->postJson("/api/v1/vehicles/{$this->draft->id}/publish")->assertUnprocessable()->assertJsonPath('code', 'vehicle_incomplete');
    });

    it('cannot be chosen as the cover', function () {
        $this->patchJson("/api/v1/vehicles/{$this->draft->id}", ['cover_media_id' => $this->rejected->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['cover_media_id']);
    });

    it('is passed over by the fallback to the first photo', function () {
        $fine = Media::factory()->forModel($this->draft)->create(['owner_id' => $this->owner->id, 'sort' => 1]);

        $this->patchJson("/api/v1/vehicles/{$this->draft->id}", ['cover_media_id' => null])->assertOk()->assertJsonPath('data.cover_media_id', $fine->id);
    });

    it('is passed over when the cover is deleted', function () {
        $cover = Media::factory()->forModel($this->draft)->create(['owner_id' => $this->owner->id, 'sort' => 1]);
        $next = Media::factory()->forModel($this->draft)->create(['owner_id' => $this->owner->id, 'sort' => 2]);
        $this->draft->forceFill(['cover_media_id' => $cover->id])->save();

        $this->deleteJson("/api/v1/media/{$cover->id}")->assertNoContent();

        expect($this->draft->refresh()->getAttribute('cover_media_id'))->toBe($next->id);
    });

    it('is no photo, and neither is one still processing', function () {
        $processing = Media::factory()->forModel($this->draft)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Processing]);

        expect($this->rejected->isUsablePhoto())->toBeFalse()
            ->and($processing->isUsablePhoto())->toBeFalse()
            ->and(Media::factory()->forModel($this->draft)->create(['owner_id' => $this->owner->id])->isUsablePhoto())->toBeTrue()
            ->and($this->draft->media()->usablePhoto()->count())->toBe(1);
    });
});

describe('a note on a draft', function () {
    it('is refused, because a draft has no history', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$draft->id}/updates", ['note' => 'Text'])->assertForbidden();

        expect(BuildUpdate::query()->where('vehicle_id', $draft->id)->count())->toBe(0);
    });

    it('is possible again once published', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/updates", ['note' => 'Text'])->assertCreated();
    });
});

describe('reorder lists', function () {
    beforeEach(function () {
        $this->vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);
    });

    /**
     * @return list<string>
     */
    function ulids(int $count): array
    {
        return array_map(fn (): string => (string) Str::ulid(), range(1, $count));
    }

    it('are refused one over the limit, under ids and before any single id', function (Closure $url, string $limit) {
        $over = config()->integer($limit) + 1;
        // Two identical ones would fail on their own further down, were the size not the first and last thing looked at.
        $ids = [...ulids($over - 1), 'keine-ulid'];

        $response = $this->putJson($url($this->vehicle), ['ids' => $ids])->assertUnprocessable()->assertJsonPath('code', 'validation_failed');

        expect(array_keys($response->json('errors')))->toBe(['ids']);
    })->with([
        'garage' => [fn (Vehicle $vehicle): string => '/api/v1/me/vehicles/order', 'speedclub.garage.max_vehicles_per_member'],
        'mods' => [fn (Vehicle $vehicle): string => "/api/v1/vehicles/{$vehicle->id}/mods/order", 'speedclub.garage.max_modifications_per_vehicle'],
        'photos' => [fn (Vehicle $vehicle): string => "/api/v1/vehicles/{$vehicle->id}/media/order", 'speedclub.garage.max_photos_per_vehicle'],
    ]);

    // 18,000 is what still fits under LimitJsonBody, so this is the longest list that reaches the size rule.
    it('of 18,000 ids are refused, also for a stranger\'s vehicle', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => ulids(18000)])->assertUnprocessable();
    });

    it('of 20,000 ids do not reach the validator at all', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => ulids(20000)])->assertStatus(413)->assertJsonPath('code', 'payload_too_large');
    });

    // ADR-154: a wall-clock limit only means something on a quiet machine, so scripts/verify.ps1 runs the group perf alone.
    it('of 18,000 ids cost next to nothing, also for a stranger\'s vehicle', function () {
        Sanctum::actingAs(User::factory()->create());
        $ids = ulids(18000);

        $start = microtime(true);
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => $ids])->assertUnprocessable();

        expect(microtime(true) - $start)->toBeLessThan(1.0);
    })->group('perf');

    it('still reject a bad id and a repeated id within the limit', function () {
        $mod = modIn($this->vehicle, 'suspension');
        $other = modIn($this->vehicle, 'exhaust');

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => [$mod->id, 'keine-ulid']])->assertUnprocessable()->assertJsonValidationErrors(['ids.1']);
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => [$mod->id, $mod->id]])->assertUnprocessable();
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => [$other->id, $mod->id]])->assertOk();
    });

    it('are throttled on all three routes', function (Closure $url) {
        config(['speedclub.rate_limits.garage_reorders.max' => 1]);
        RateLimits::register();

        $this->putJson($url($this->vehicle), ['ids' => ['keine-ulid']]);
        $this->putJson($url($this->vehicle), ['ids' => ['keine-ulid']])->assertTooManyRequests()->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
    })->with([
        'garage' => [fn (Vehicle $vehicle): string => '/api/v1/me/vehicles/order'],
        'mods' => [fn (Vehicle $vehicle): string => "/api/v1/vehicles/{$vehicle->id}/mods/order"],
        'photos' => [fn (Vehicle $vehicle): string => "/api/v1/vehicles/{$vehicle->id}/media/order"],
    ]);
});

describe('catalogue requests through the wizard', function () {
    beforeEach(function () {
        config(['speedclub.rate_limits.catalog_requests.max' => 3]);
        $this->draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);
    });

    it('stop at the limit, and the vehicle still saves its text', function () {
        foreach (range(1, 5) as $i) {
            $this->patchJson("/api/v1/vehicles/{$this->draft->id}", ['make_text' => 'Marke '.$i])->assertOk()->assertJsonPath('data.make_text', 'Marke '.$i);
        }

        expect(CatalogRequest::query()->where('user_id', $this->owner->id)->count())->toBe(3);
    });

    it('also count on a new draft and what the catalogue route filed', function () {
        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'Direkt'])->assertCreated();

        foreach (range(1, 4) as $i) {
            $this->postJson('/api/v1/vehicles', ['make_text' => 'Marke '.$i])->assertCreated();
        }

        expect(CatalogRequest::query()->where('user_id', $this->owner->id)->count())->toBe(3);
    });

    it('open up again after the window', function () {
        foreach (range(1, 3) as $i) {
            $this->patchJson("/api/v1/vehicles/{$this->draft->id}", ['make_text' => 'Marke '.$i])->assertOk();
        }

        $this->travel(config()->integer('speedclub.rate_limits.catalog_requests.minutes') + 1)->minutes();
        $this->patchJson("/api/v1/vehicles/{$this->draft->id}", ['make_text' => 'Marke 4'])->assertOk();

        expect(CatalogRequest::query()->where('user_id', $this->owner->id)->count())->toBe(4);
    });

    it('count per member', function () {
        foreach (range(1, 3) as $i) {
            $this->patchJson("/api/v1/vehicles/{$this->draft->id}", ['make_text' => 'Marke '.$i])->assertOk();
        }

        $other = User::factory()->create();
        Sanctum::actingAs($other);
        $this->postJson('/api/v1/vehicles', ['make_text' => 'Andere'])->assertCreated();

        expect(CatalogRequest::query()->where('user_id', $other->id)->count())->toBe(1);
    });
});

describe('a forged cursor with empty values', function () {
    it('is refused, not a 500', function (Closure $url, array $parameters) {
        $vehicle = publishedVehicle($this->owner);
        BuildUpdate::factory()->count(3)->create(['vehicle_id' => $vehicle->id]);
        Sanctum::actingAs($this->owner);

        $this->getJson($url($vehicle).'?cursor='.encodedCursor($parameters))->assertUnprocessable()->assertJsonValidationErrors(['cursor']);
    })->with([
        'public updates, both' => [fn (Vehicle $vehicle): string => '/api/v1/public/vehicles/'.$vehicle->canonicalSlug().'/updates', ['created_at' => null, 'id' => null]],
        'public updates, the date' => [fn (Vehicle $vehicle): string => '/api/v1/public/vehicles/'.$vehicle->canonicalSlug().'/updates', ['created_at' => null, 'id' => 'x']],
        'public updates, the id' => [fn (Vehicle $vehicle): string => '/api/v1/public/vehicles/'.$vehicle->canonicalSlug().'/updates', ['created_at' => 'x', 'id' => null]],
        'garage' => [fn (Vehicle $vehicle): string => '/api/v1/me/vehicles', ['is_main' => null, 'sort' => null, 'id' => null]],
        'catalogue' => [fn (Vehicle $vehicle): string => '/api/v1/catalog/makes', ['is_popular' => null, 'sort' => null, 'name' => null, 'id' => null]],
    ]);

    it('leaves real cursors working, with their false and 0', function () {
        foreach (range(1, 3) as $i) {
            publishedVehicle($this->owner);
        }

        Sanctum::actingAs($this->owner);
        $cursor = $this->getJson('/api/v1/me/vehicles?per_page=1')->assertOk()->json('meta.next_cursor');

        $this->getJson('/api/v1/me/vehicles?per_page=1&cursor='.$cursor)->assertOk()->assertJsonCount(1, 'data');
    });

    it('leaves the catalogue pages working', function () {
        Make::factory()->count(3)->create();

        $cursor = $this->getJson('/api/v1/catalog/makes?per_page=1')->assertOk()->json('meta.next_cursor');

        $this->getJson('/api/v1/catalog/makes?per_page=1&cursor='.$cursor)->assertOk()->assertJsonCount(1, 'data');
    });
});

describe('notes of a modification', function () {
    beforeEach(function () {
        $this->vehicle = publishedVehicle($this->owner);
        $this->mod = modIn($this->vehicle, 'suspension', [], ['notes' => 'Nur für mich']);
    });

    it('are the owner\'s', function () {
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/mods/{$this->mod->id}")->assertOk()->assertJsonPath('data.notes', 'Nur für mich');
        $this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug()."/mods/{$this->mod->id}")->assertOk()->assertJsonPath('data.notes', 'Nur für mich');
    });

    it('stay away from a guest and another member on every route', function () {
        $response = $this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug()."/mods/{$this->mod->id}")->assertOk()->assertJsonPath('data.notes', null);
        expect($response->getContent())->not->toContain('Nur für mich');

        expect($this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug())->assertOk()->getContent())->not->toContain('Nur für mich');

        Sanctum::actingAs(User::factory()->create());

        foreach (["/api/v1/mods/{$this->mod->id}", "/api/v1/vehicles/{$this->vehicle->id}/mods", '/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug()."/mods/{$this->mod->id}"] as $url) {
            expect($this->getJson($url)->assertOk()->getContent())->not->toContain('Nur für mich');
        }
    });
});
