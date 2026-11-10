<?php

use App\Enums\BuildUpdateType;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use App\Services\Media\ProcessMedia;
use App\Services\Qr\QrCodes;
use App\Services\Search\RebuildVehicleSearch;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Codes;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/GarageTestHelpers.php';

/*
 * The controls of 07_QA_AND_RELEASE §6 for the garage API, from the side of somebody trying to get around them.
 */

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
});

function gsPublicUrl(Vehicle $vehicle, string $suffix = ''): string
{
    return '/api/v1/public/vehicles/'.$vehicle->canonicalSlug().$suffix;
}

/**
 * Every key anywhere in a decoded JSON answer.
 *
 * @param  array<array-key, mixed>  $json
 * @return list<string>
 */
function gsKeys(array $json): array
{
    $keys = [];

    foreach ($json as $key => $value) {
        if (is_string($key)) {
            $keys[] = $key;
        }

        if (is_array($value)) {
            $keys = [...$keys, ...gsKeys($value)];
        }
    }

    return $keys;
}

/**
 * @param  array<string, mixed>  $parameters
 */
function gsCursor(array $parameters): string
{
    return rtrim(strtr(base64_encode((string) json_encode([...$parameters, '_pointsToNextItems' => true])), '+/', '-_'), '=');
}

/**
 * @return list<LaravelRoute>
 */
function gsRoutes(string ...$namespaces): array
{
    $prefixes = array_map(fn (string $namespace): string => "App\\Http\\Controllers\\Api\\V1\\$namespace\\", $namespaces);

    return array_values(array_filter(
        Route::getRoutes()->getRoutes(),
        fn (LaravelRoute $route): bool => Str::startsWith($route->getActionName(), $prefixes),
    ));
}

/**
 * Who cannot see a vehicle, and why. Each returns the vehicle and who asks.
 *
 * @return array<string, array{0: Closure(User): array{0: Vehicle, 1: User|null}}>
 */
function gsHiddenStates(): array
{
    $stranger = fn (): User => User::factory()->create();

    return [
        'private, guest' => [fn (User $o) => [publishedVehicle($o, ['visibility' => 'private']), null]],
        'private, other member' => [fn (User $o) => [publishedVehicle($o, ['visibility' => 'private']), $stranger()]],
        'draft, other member' => [fn (User $o) => [Vehicle::factory()->create(['owner_id' => $o->id]), $stranger()]],
        'archived, guest' => [fn (User $o) => [Vehicle::factory()->archived()->create(['owner_id' => $o->id]), null]],
        'deleted, guest' => [function (User $o) {
            $vehicle = publishedVehicle($o);
            $vehicle->delete();

            return [$vehicle, null];
        }],
        'deleted, other member' => [function (User $o) use ($stranger) {
            $vehicle = publishedVehicle($o);
            $vehicle->delete();

            return [$vehicle, $stranger()];
        }],
        'owner blocked the viewer' => [function (User $o) use ($stranger) {
            $viewer = $stranger();
            Block::factory()->create(['blocker_id' => $o->id, 'blocked_id' => $viewer->id]);

            return [publishedVehicle($o), $viewer];
        }],
        'viewer blocked the owner' => [function (User $o) use ($stranger) {
            $viewer = $stranger();
            Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $o->id]);

            return [publishedVehicle($o), $viewer];
        }],
        'suspended owner' => [fn (User $o) => [publishedVehicle(User::factory()->suspended()->create()), null]],
        'unverified owner' => [fn (User $o) => [publishedVehicle(User::factory()->unverified()->create()), null]],
        'deactivated owner' => [fn (User $o) => [publishedVehicle(User::factory()->deactivated()->create()), null]],
    ];
}

describe('route wiring', function () {
    it('puts every garage, media and follow route behind the member group', function () {
        $routes = gsRoutes('Garage', 'Media', 'Social');

        expect(count($routes))->toBeGreaterThan(20);

        foreach ($routes as $route) {
            expect($route->gatherMiddleware())->toContain('member');
        }
    });

    it('throttles every creating POST and lets it replay', function () {
        $creating = array_filter(gsRoutes('Garage', 'Media'), fn (LaravelRoute $route): bool => in_array('POST', $route->methods(), true) && Str::endsWith((string) $route->getName(), '.store'));

        expect(count($creating))->toBe(5);

        foreach ($creating as $route) {
            $middleware = $route->gatherMiddleware();

            expect($middleware)->toContain('idempotent')
                ->and(array_filter($middleware, fn (mixed $name): bool => is_string($name) && str_starts_with($name, 'throttle:')))->not->toBeEmpty();
        }
    });

    it('asks for a verified address where something gets public or somebody followed', function () {
        foreach (['api.v1.vehicles.publish', 'api.v1.follows.store', 'api.v1.follows.destroy'] as $name) {
            expect(Route::getRoutes()->getByName($name)?->gatherMiddleware())->toContain('verified-member');
        }

        expect(Route::getRoutes()->getByName('api.v1.vehicles.publish')?->gatherMiddleware())->toContain('idempotent')
            ->and(Route::getRoutes()->getByName('api.v1.follows.store')?->gatherMiddleware())->toContain('throttle:follows');
    });

    it('limits every anonymous route per address and keeps it out of shared caches', function () {
        $routes = gsRoutes('Public');

        // M2.1 added the follower lists of PROF-04.
        expect(count($routes))->toBe(8);

        foreach ($routes as $route) {
            expect($route->gatherMiddleware())->toContain('throttle:public-read', 'etag')->not->toContain('member');
        }

        $this->getJson(gsPublicUrl(publishedVehicle($this->owner)))->assertOk()->assertHeader('Cache-Control', 'no-cache, private');
    });
});

describe('fields a client cannot set', function () {
    it('ignores ownership and lifecycle on POST vehicles', function () {
        $stranger = User::factory()->create();
        $ulid = (string) Str::ulid();
        Sanctum::actingAs($this->owner);

        $id = $this->postJson('/api/v1/vehicles', [
            'id' => $ulid, 'owner_id' => $stranger->id, 'public_id' => 'AAAAAAAA', 'slug' => 'gesetzt', 'status' => 'published', 'visibility' => 'private',
            'is_main' => true, 'sort' => 99, 'published_at' => '2020-01-01', 'archived_at' => '2020-01-01', 'deleted_at' => '2020-01-01',
        ])->assertCreated()->json('data.id');

        $vehicle = Vehicle::query()->findOrFail($id);

        expect($id)->not->toBe($ulid)
            ->and($vehicle->owner_id)->toBe($this->owner->id)
            ->and($vehicle->public_id)->not->toBe('AAAAAAAA')
            ->and($vehicle->slug)->not->toContain('gesetzt')
            ->and($vehicle->status)->toBe(VehicleStatus::Draft)
            ->and($vehicle->visibility)->toBe(Visibility::Public)
            ->and($vehicle->is_main)->toBeFalse()
            ->and($vehicle->getAttribute('sort'))->toBe(0)
            ->and($vehicle->getAttribute('published_at'))->toBeNull()
            ->and($vehicle->getAttribute('archived_at'))->toBeNull();
    });

    it('ignores them on PATCH vehicles as well', function () {
        $vehicle = publishedVehicle($this->owner, ['visibility' => 'unlisted', 'is_main' => false, 'sort' => 5]);
        $keys = ['id', 'owner_id', 'public_id', 'status', 'visibility', 'is_main', 'sort', 'published_at', 'archived_at', 'deleted_at', 'wizard_step'];
        $before = array_intersect_key($vehicle->refresh()->getAttributes(), array_flip($keys));
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", [
            'nickname' => 'Neu', 'id' => (string) Str::ulid(), 'owner_id' => User::factory()->create()->id, 'public_id' => 'AAAAAAAA', 'status' => 'draft',
            'visibility' => 'public', 'is_main' => true, 'sort' => 1, 'slug' => 'gesetzt', 'published_at' => '2020-01-01', 'archived_at' => '2020-01-01', 'deleted_at' => '2020-01-01',
        ])->assertOk();

        $vehicle->refresh();

        expect($vehicle->getAttribute('nickname'))->toBe('Neu')
            ->and($vehicle->slug)->not->toContain('gesetzt')
            ->and(array_intersect_key($vehicle->getAttributes(), array_flip($keys)))->toEqual($before);
    });

    it('ignores the owner of a modification, and refuses another category', function () {
        $vehicle = publishedVehicle($this->owner);
        $foreign = publishedVehicle();
        $ulid = (string) Str::ulid();
        Sanctum::actingAs($this->owner);

        $id = $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", [
            'category' => 'other', 'title' => 'Teil', 'id' => $ulid, 'vehicle_id' => $foreign->id, 'category_id' => modCategory('exhaust')->id, 'sort' => 99, 'deleted_at' => '2020-01-01',
        ])->assertCreated()->json('data.id');

        $mod = Modification::query()->findOrFail($id);

        expect($id)->not->toBe($ulid)
            ->and($mod->vehicle_id)->toBe($vehicle->id)
            ->and($mod->category->key)->toBe('other')
            ->and($mod->getAttribute('sort'))->toBe(1)
            ->and($foreign->modifications()->count())->toBe(0);

        $this->patchJson("/api/v1/mods/{$id}", ['notes' => 'x', 'vehicle_id' => $foreign->id, 'category_id' => modCategory('exhaust')->id, 'sort' => 99])->assertOk();
        expect($mod->refresh()->vehicle_id)->toBe($vehicle->id)->and($mod->category->key)->toBe('other')->and($mod->getAttribute('sort'))->toBe(1);

        $this->patchJson("/api/v1/mods/{$id}", ['category' => 'exhaust'])->assertUnprocessable()->assertJsonValidationErrorFor('category');
    });

    it('takes only the note on a build update, and only hidden on its edit', function () {
        $vehicle = publishedVehicle($this->owner);
        $foreign = publishedVehicle();
        Sanctum::actingAs($this->owner);

        $id = $this->postJson("/api/v1/vehicles/{$vehicle->id}/updates", [
            'note' => 'Text', 'hidden' => true, 'type' => BuildUpdateType::ModAdded->value, 'vehicle_id' => $foreign->id, 'payload' => ['after' => 'x'], 'created_at' => '2020-01-01',
        ])->assertCreated()->json('data.id');

        $update = BuildUpdate::query()->findOrFail($id);

        expect($update->type)->toBe(BuildUpdateType::Note)
            ->and($update->hidden)->toBeFalse()
            ->and($update->getAttribute('vehicle_id'))->toBe($vehicle->id)
            ->and($update->payload)->toBeNull()
            ->and($update->getAttribute('created_at')->year)->toBe(now()->year);

        $this->patchJson("/api/v1/updates/{$id}", ['hidden' => true, 'note' => 'Anders', 'vehicle_id' => $foreign->id, 'payload' => ['after' => 'x']])->assertOk();

        expect($update->refresh()->hidden)->toBeTrue()
            ->and($update->getAttribute('note'))->toBe('Text')
            ->and($update->getAttribute('vehicle_id'))->toBe($vehicle->id)
            ->and($update->payload)->toBeNull();
    });

    it('computes the normalised power itself', function () {
        $vehicle = publishedVehicle($this->owner);
        $foreign = publishedVehicle();
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 100, 'power_unit' => 'ps', 'power_ps' => 9999, 'vehicle_id' => $foreign->id])->assertOk();

        expect((float) VehicleSpec::query()->findOrFail($vehicle->id)->power_ps)->toBe(100.0)
            ->and(VehicleSpec::query()->find($foreign->id))->toBeNull();
    });

    it('keeps the pipeline fields of a mod photo to the server', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        $stranger = User::factory()->create();
        Sanctum::actingAs($this->owner);

        $id = $this->post("/api/v1/mods/{$mod->id}/media", [
            'file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300)),
            'owner_id' => $stranger->id, 'mediable_id' => $vehicle->id, 'mediable_type' => 'vehicle', 'status' => 'failed', 'moderation_status' => 'approved', 'disk' => 'local', 'sort' => 42, 'variants' => '{}',
        ], ['Accept' => 'application/json'])->assertCreated()->json('data.id');

        $media = Media::query()->findOrFail($id);

        expect($media->owner_id)->toBe($this->owner->id)
            ->and($media->getAttribute('mediable_id'))->toBe($mod->id)
            ->and($media->getAttribute('mediable_type'))->toBe('modification')
            ->and($media->status)->toBe(MediaStatus::Ready)
            ->and($media->moderation_status)->toBe(ModerationStatus::Pending)
            ->and($media->getAttribute('sort'))->toBe(0);
    });
});

describe('objects of another member', function () {
    it('refuses a stranger\'s modification in a reorder list, also at the same length', function () {
        $vehicle = publishedVehicle($this->owner);
        $mine = modIn($vehicle, 'exhaust', attributes: ['sort' => 7]);
        $theirs = modIn(publishedVehicle(), 'exhaust', attributes: ['sort' => 9]);
        Sanctum::actingAs($this->owner);

        foreach ([[$theirs->id], [$mine->id, $theirs->id]] as $ids) {
            $this->putJson("/api/v1/vehicles/{$vehicle->id}/mods/order", ['ids' => $ids])->assertUnprocessable()->assertJsonValidationErrorFor('ids');
        }

        expect($theirs->refresh()->getAttribute('sort'))->toBe(9)->and($mine->refresh()->getAttribute('sort'))->toBe(7);
    });

    it('does not take a photo of the same owner\'s other vehicle, a mod photo or a deleted one as cover', function () {
        $vehicle = publishedVehicle($this->owner);
        $otherVehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        $deleted = Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id]);
        $deleted->delete();
        Sanctum::actingAs($this->owner);

        foreach ([
            Media::query()->where('mediable_id', $otherVehicle->id)->firstOrFail()->id,
            Media::factory()->forModel($mod)->create(['owner_id' => $this->owner->id])->id,
            $deleted->id,
            Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Processing])->id,
        ] as $id) {
            $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['cover_media_id' => $id])->assertUnprocessable()->assertJsonValidationErrorFor('cover_media_id');
        }
    });

    it('does not read an entry of another vehicle through a vehicle one may see', function () {
        $page = publishedVehicle($this->owner);
        $hidden = publishedVehicle($this->owner, ['visibility' => 'private']);
        $update = BuildUpdate::factory()->create(['vehicle_id' => $hidden->id]);
        $mod = modIn($hidden, 'exhaust');

        $this->getJson(gsPublicUrl($page, "/updates/{$update->id}"))->assertNotFound();
        $this->getJson(gsPublicUrl($page, "/mods/{$mod->id}"))->assertNotFound();
    });

    it('closes everything of a deleted vehicle for its owner, also through the children', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        $update = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);
        $vehicle->delete();
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/mods/{$mod->id}")->assertNotFound();
        $this->patchJson("/api/v1/mods/{$mod->id}", ['notes' => 'x'])->assertForbidden();
        $this->deleteJson("/api/v1/mods/{$mod->id}")->assertForbidden();
        $this->post("/api/v1/mods/{$mod->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->assertForbidden();
        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => true])->assertForbidden();
        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'other', 'title' => 'x'])->assertNotFound();
        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", [])->assertNotFound();
        $this->postJson("/api/v1/vehicles/{$vehicle->id}/updates", ['note' => 'x'])->assertNotFound();
    });

    it('answers a missing object without naming a class or a key', function () {
        Sanctum::actingAs($this->owner);
        $ulid = (string) Str::ulid();

        foreach (["/api/v1/vehicles/{$ulid}", "/api/v1/mods/{$ulid}"] as $url) {
            $body = $this->getJson($url)->assertNotFound()->assertJsonPath('code', 'not_found')->getContent();

            expect($body)->not->toContain('App\\')->not->toContain('Models')->not->toContain($ulid);
        }
    });
});

describe('hidden states', function () {
    it('are the same nothing on every public route', function (Closure $state) {
        [$vehicle, $viewer] = $state($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        $update = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        foreach (['', "/mods/{$mod->id}", '/updates', "/updates/{$update->id}"] as $suffix) {
            $answer = $this->getJson(gsPublicUrl($vehicle, $suffix))->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
            $nothing = $this->getJson('/api/v1/public/vehicles/nichts-ZZZZZZZZ'.$suffix)->assertNotFound();

            expect($answer->getContent())->toBe($nothing->getContent());
        }
    })->with(gsHiddenStates());

    it('neither redirect for another text nor answer to a tag', function (Closure $state) {
        [$vehicle, $viewer] = $state($this->owner);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $this->getJson('/api/v1/public/vehicles/falsch-'.$vehicle->public_id)->assertNotFound();
        $this->getJson(gsPublicUrl($vehicle), ['If-None-Match' => '*'])->assertNotFound();
    })->with(gsHiddenStates());

    it('are the same nothing on the member routes', function (Closure $state) {
        [$vehicle, $viewer] = $state($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        Sanctum::actingAs($viewer ?? User::factory()->create());

        foreach (['/vehicles/{vehicle}', '/vehicles/{vehicle}/mods', '/vehicles/{vehicle}/updates', '/mods/{mod}'] as $path) {
            $url = fn (string $vehicleId, string $modId): string => '/api/v1'.str_replace(['{vehicle}', '{mod}'], [$vehicleId, $modId], $path);
            $answer = $this->getJson($url($vehicle->id, $mod->id))->assertNotFound();
            $nothing = $this->getJson($url((string) Str::ulid(), (string) Str::ulid()))->assertNotFound();

            expect($answer->getContent())->toBe($nothing->getContent());
        }
    })->with(gsHiddenStates());

    it('do not come back through a token that is no longer valid', function (Closure $token) {
        $vehicle = publishedVehicle($this->owner, ['visibility' => 'private']);

        $this->withToken($token($this->owner))->getJson(gsPublicUrl($vehicle))->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    })->with([
        'expired' => [fn (User $owner) => $owner->createToken('Phone', ['member'], now()->subSecond())->plainTextToken],
        'revoked' => [function (User $owner) {
            $token = $owner->createToken('Phone', ['member'], now()->addDay());
            $token->accessToken->delete();

            return $token->plainTextToken;
        }],
        'nonsense' => [fn (User $owner) => '1|nichtsdergleichen'],
    ]);

    it('open for the owner\'s valid token', function () {
        $vehicle = publishedVehicle($this->owner, ['visibility' => 'private']);
        $token = $this->owner->createToken('Phone', ['member'], now()->addDay())->plainTextToken;

        $this->withToken($token)->getJson(gsPublicUrl($vehicle))->assertOk()->assertJsonPath('data.is_owner', true);
    });

    it('open an unlisted vehicle by link, and only by link', function () {
        $vehicle = publishedVehicle($this->owner, ['visibility' => 'unlisted']);

        $this->getJson(gsPublicUrl($vehicle))->assertOk();
        $this->getJson('/api/v1/public/users/lukas.sc/vehicles')->assertOk()->assertJsonPath('data', []);
        $this->getJson('/api/v1/public/users/lukas.sc')->assertOk()->assertJsonPath('data.stats.vehicles', 0);

        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        expect(VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('is_public'))->toBeFalse();
    });
});

describe('what the public reads', function () {
    beforeEach(function () {
        $this->owner->forceFill(['previous_username' => 'alter.name', 'username_changed_at' => now()->subYear()])->save();
        $this->page = publishedVehicle($this->owner, ['hu_au_due' => '2027-03-01']);
        $this->qr = app(QrCodes::class)->ensureActive($this->page);
        $this->mod = modIn($this->page, 'exhaust', attributes: ['title' => 'Sichtbar', 'cost_cents' => 7654321, 'cost_public' => false, 'status' => 'installed']);
        $this->deletedMod = modIn($this->page, 'exhaust', attributes: ['title' => 'GELOESCHT-TITEL']);
        $this->deletedMod->delete();
        $this->rejected = Media::factory()->forModel($this->page)->create(['owner_id' => $this->owner->id, 'moderation_status' => ModerationStatus::Rejected]);
        $this->processing = Media::factory()->forModel($this->page)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Processing]);
        $this->page->forceFill(['cover_media_id' => $this->rejected->id])->save();
        $this->rejectedModPhoto = Media::factory()->forModel($this->mod)->create(['owner_id' => $this->owner->id, 'moderation_status' => ModerationStatus::Rejected]);
        $this->visibleUpdate = BuildUpdate::factory()->create(['vehicle_id' => $this->page->id, 'type' => BuildUpdateType::Note, 'note' => 'Sichtbare Notiz', 'payload' => null]);
        $this->hiddenUpdate = BuildUpdate::factory()->create(['vehicle_id' => $this->page->id, 'type' => BuildUpdateType::Note, 'note' => 'VERSTECKTE-NOTIZ', 'payload' => null, 'hidden' => true]);
        publishedVehicle($this->owner, ['visibility' => 'private', 'nickname' => 'PRIVATER-NAME']);
        publishedVehicle($this->owner, ['visibility' => 'unlisted', 'nickname' => 'UNGELISTETER-NAME']);
        Vehicle::factory()->create(['owner_id' => $this->owner->id, 'nickname' => 'ENTWURF-NAME']);
    });

    it('holds no private field, whoever asks but the owner', function (string $who) {
        if ($who === 'member') {
            Sanctum::actingAs(User::factory()->create());
        }

        $slug = $this->page->canonicalSlug();

        foreach (["/vehicles/{$slug}", "/vehicles/{$slug}/mods/{$this->mod->id}", "/vehicles/{$slug}/updates", "/vehicles/{$slug}/updates/{$this->visibleUpdate->id}", '/users/lukas.sc', '/users/lukas.sc/vehicles'] as $url) {
            $response = $this->getJson('/api/v1/public'.$url)->assertOk();
            $body = (string) $response->getContent();

            expect(array_intersect(gsKeys($response->json()), [
                'email', 'email_verified_at', 'password', 'cost_cents', 'hu_au_due', 'restrictions', 'force_password_change', 'previous_username', 'username_changed_at',
                'owner_id', 'payload', 'open_until', 'moderation_status', 'disk', 'original_path', 'totp_secret', 'remember_token',
            ]))->toBe([]);

            foreach ([$this->owner->email, 'alter.name', '7654321', '76.543', 'VERSTECKTE-NOTIZ', 'GELOESCHT-TITEL', 'PRIVATER-NAME', 'UNGELISTETER-NAME', 'ENTWURF-NAME', $this->qr->code, '2027-03', $this->rejected->id, $this->processing->id, $this->rejectedModPhoto->id] as $secret) {
                expect($body)->not->toContain($secret);
            }
        }
    })->with(['guest', 'member']);

    it('counts only what may be seen, and gives the stored fields to the owner alone', function () {
        $page = gsPublicUrl($this->page);
        $mod = gsPublicUrl($this->page, "/mods/{$this->mod->id}");

        $this->getJson($page)->assertOk()
            ->assertJsonPath('data.updates_count', 1)
            ->assertJsonPath('data.is_owner', false)
            ->assertJsonPath('data.mods.count', 1)
            ->assertJsonPath('data.photo_count', 1)
            ->assertJsonPath('data.completeness', null)
            ->assertJsonPath('data.qr', null);
        $this->getJson($mod)->assertOk()->assertJsonPath('data.fields', null)->assertJsonPath('data.cost', null);

        Sanctum::actingAs($this->owner);

        $this->getJson($page)->assertOk()->assertJsonPath('data.updates_count', 2)->assertJsonPath('data.is_owner', true)->assertJsonPath('data.qr.code', $this->qr->code);
        $this->getJson($mod)->assertOk()->assertJsonPath('data.cost.cents', 7654321);
    });
});

describe('public ids', function () {
    it('come from a random source and are not sequential', function () {
        Sanctum::actingAs($this->owner);
        $ids = [];

        for ($i = 0; $i < 6; $i++) {
            $ids[] = Vehicle::query()->findOrFail($this->postJson('/api/v1/vehicles')->assertCreated()->json('data.id'))->public_id;
        }

        foreach ($ids as $index => $id) {
            expect(Codes::isValid($id))->toBeTrue();

            if ($index > 0) {
                expect(substr($id, 0, 6))->not->toBe(substr($ids[$index - 1], 0, 6));
            }
        }

        $many = array_map(fn (): string => Codes::generate(), range(1, 2000));

        expect(array_unique($many))->toHaveCount(2000)
            ->and(strlen(Codes::ALPHABET) ** Codes::LENGTH)->toBeGreaterThan(10 ** 12);
    });

    it('are the only way in: no database id, no number, no read-alike', function () {
        $vehicle = publishedVehicle($this->owner);

        foreach ([$vehicle->id, '1', '2', '00000001', 'IIIIIIII', 'LLLLLLLL', 'OOOOOOOO', 'UUUUUUUU', $vehicle->public_id.'0', substr($vehicle->public_id, 0, 7)] as $guess) {
            $this->getJson("/api/v1/public/vehicles/{$guess}")->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        }

        Sanctum::actingAs($this->owner);

        foreach ([$vehicle->public_id, $vehicle->canonicalSlug(), '1'] as $guess) {
            $this->getJson("/api/v1/vehicles/{$guess}")->assertNotFound();
        }
    });

    it('cannot be walked: misses count against the address', function () {
        config(['speedclub.rate_limits.public_read.max' => 3]);
        RateLimits::register();

        foreach (['AAAAAAAA', 'AAAAAAAB', 'AAAAAAAC'] as $guess) {
            $this->getJson("/api/v1/public/vehicles/{$guess}")->assertNotFound();
        }

        $this->getJson('/api/v1/public/vehicles/AAAAAAAD')->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
    });
});

describe('free text', function () {
    it('is stored and answered as data, and never reaches a URL', function () {
        $markup = '<script>alert(1)</script>';
        Sanctum::actingAs($this->owner);

        $id = $this->postJson('/api/v1/vehicles', ['make_text' => $markup, 'model_text' => '"><img src=x>', 'nickname' => $markup, 'description' => $markup, 'color' => $markup])
            ->assertCreated()->assertHeader('Content-Type', 'application/json')->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertJsonPath('data.nickname', $markup)->assertJsonPath('data.make', $markup)
            ->json('data.id');

        $vehicle = Vehicle::query()->findOrFail($id);

        expect($vehicle->getRawOriginal('nickname'))->toBe($markup)
            ->and($vehicle->slug)->toMatch('/\A[a-z0-9-]+\z/');

        $vehicle->forceFill(['status' => VehicleStatus::Published, 'model_year' => 2020])->save();
        Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id]);

        $note = $this->postJson("/api/v1/vehicles/{$id}/updates", ['note' => $markup])->assertCreated()->assertJsonPath('data.note', $markup)->json('data.id');
        $mod = $this->postJson("/api/v1/vehicles/{$id}/mods", ['category' => 'other', 'title' => $markup, 'notes' => $markup, 'brand_text' => $markup, 'part_name' => $markup])
            ->assertCreated()->assertJsonPath('data.title', $markup)->assertJsonPath('data.notes', $markup)->json('data.id');

        $page = $this->getJson('/api/v1/public/vehicles/'.$vehicle->refresh()->slug)->assertOk()->assertHeader('Content-Type', 'application/json');

        expect($page->json('data.canonical_url'))->toMatch('~/v/[a-z0-9-]+\z~')
            ->and(BuildUpdate::query()->findOrFail($note)->getRawOriginal('note'))->toBe($markup)
            ->and(Modification::query()->findOrFail($mod)->getRawOriginal('notes'))->toBe($markup);
    });

    it('is a value in the search text, not a statement', function () {
        $statement = "Robert'); DROP TABLE vehicles;--";
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['nickname' => $statement])->assertOk();
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);

        expect(VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('search_text'))->toContain($statement)
            ->and(Vehicle::query()->whereKey($vehicle->id)->value('nickname'))->toBe($statement);
    });
});

describe('fields of a modification', function () {
    it('refuse what the schema does not know or does not type that way', function (string $key, mixed $value) {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => [$key => $value]])
            ->assertUnprocessable()->assertJsonValidationErrorFor("fields.$key");

        expect($vehicle->modifications()->count())->toBe(0);
    })->with([
        'unknown' => ['evil', 'x'],
        'a prototype' => ['__proto__', ['admin' => true]],
        'a constructor' => ['constructor', 'x'],
        'a smuggled cost' => ['cost_cents', 100],
        'a smuggled owner' => ['owner_id', 'x'],
        'number as text' => ['diameter', '19'],
        'number as object' => ['diameter', ['value' => 19, 'unit' => 'cm']],
        'number as list' => ['diameter', [19]],
        'text as object' => ['wheel_brand', ['$ne' => 'x']],
        'text as number' => ['wheel_brand', 5],
        'boolean as text' => ['staggered', 'true'],
    ]);

    it('refuse infinity, which JSON can spell but not store', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->call('POST', "/api/v1/vehicles/{$vehicle->id}/mods", [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'], '{"category":"wheels_tires","fields":{"diameter":1e999}}')
            ->assertUnprocessable();

        expect($vehicle->modifications()->count())->toBe(0);
    });

    it('stay as they were after a refused PATCH', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'wheels_tires', ['diameter' => 19]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/mods/{$mod->id}", ['fields' => ['diameter' => 18, 'evil' => 'x']])->assertUnprocessable()->assertJsonValidationErrorFor('fields.evil');

        expect($mod->refresh()->getAttribute('fields'))->toBe(['diameter' => 19]);
    });
});

describe('idempotency', function () {
    it('never answers one member with what another created', function () {
        $first = User::factory()->create();
        $second = User::factory()->create();

        Sanctum::actingAs($first);
        $mine = $this->postJson('/api/v1/vehicles', ['nickname' => 'Erster'], ['Idempotency-Key' => 'gleich'])->assertCreated();

        Sanctum::actingAs($second);
        $theirs = $this->postJson('/api/v1/vehicles', ['nickname' => 'Erster'], ['Idempotency-Key' => 'gleich'])->assertCreated()->assertHeaderMissing('Idempotency-Replayed');

        expect($theirs->json('data.id'))->not->toBe($mine->json('data.id'))
            ->and(Vehicle::query()->findOrFail($theirs->json('data.id'))->owner_id)->toBe($second->id);
    });

    it('does not let a stranger replay a modification on somebody\'s vehicle', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'other', 'title' => 'x', 'cost_cents' => 500], ['Idempotency-Key' => 'gleich'])->assertCreated();

        Sanctum::actingAs(User::factory()->create());
        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'other', 'title' => 'x', 'cost_cents' => 500], ['Idempotency-Key' => 'gleich'])->assertForbidden();

        expect($vehicle->modifications()->count())->toBe(1);
    });

    it('keeps a key to one path and one body', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles', ['nickname' => 'A'], ['Idempotency-Key' => 'gleich'])->assertCreated();
        $this->postJson('/api/v1/vehicles', ['nickname' => 'B'], ['Idempotency-Key' => 'gleich'])->assertStatus(409)->assertJsonPath('code', 'idempotency_key_reused');
        $this->postJson("/api/v1/vehicles/{$vehicle->id}/updates", ['note' => 'A'], ['Idempotency-Key' => 'gleich'])->assertCreated();
        $this->postJson('/api/v1/vehicles', ['nickname' => 'C'], ['Idempotency-Key' => 'nicht gueltig'])->assertStatus(400);
    });
});

describe('SQL', function () {
    it('holds input as bindings, wherever it comes from', function () {
        $payload = "x' OR '1'='1";
        $encoded = rawurlencode($payload);
        $vehicle = publishedVehicle($this->owner);
        $statements = [];
        Sanctum::actingAs($this->owner);
        DB::listen(function ($query) use (&$statements): void {
            $statements[] = $query->sql;
        });

        $responses = [
            $this->getJson("/api/v1/me/vehicles?sort={$encoded}&order={$encoded}&direction={$encoded}&filter[{$encoded}]={$encoded}"),
            $this->getJson("/api/v1/public/users/{$encoded}"),
            $this->getJson("/api/v1/public/users/{$encoded}/vehicles?sort={$encoded}"),
            $this->getJson(gsPublicUrl($vehicle, "/mods/{$encoded}")),
            $this->getJson(gsPublicUrl($vehicle, "/updates/{$encoded}")),
            $this->getJson(gsPublicUrl($vehicle, "/updates?order={$encoded}")),
            $this->getJson('/api/v1/public/vehicles/'.$encoded),
            $this->getJson("/api/v1/vehicles/{$encoded}"),
            $this->getJson("/api/v1/mods/{$encoded}"),
            $this->deleteJson("/api/v1/users/{$encoded}/follow"),
            $this->getJson(gsPublicUrl($vehicle, '/updates?cursor='.gsCursor(['created_at' => $payload, 'id' => $payload]))),
            $this->getJson('/api/v1/me/vehicles?cursor='.gsCursor(['is_main' => $payload, 'sort' => $payload, 'id' => $payload])),
        ];

        foreach ($responses as $response) {
            expect($response->getStatusCode())->toBeLessThan(500);
        }

        expect(count($statements))->toBeGreaterThan(5);

        foreach ($statements as $sql) {
            expect(strtolower($sql))->not->toContain("or '1'")->not->toContain("x'");
        }
    });

    it('takes no order column from a client: the columns of a cursor are fixed', function () {
        $vehicle = publishedVehicle($this->owner);
        $evil = 'id`) or 1=1 -- ';

        $this->getJson(gsPublicUrl($vehicle, '/updates?cursor='.gsCursor([$evil => 'x'])))->assertUnprocessable()->assertJsonValidationErrorFor('cursor');
        $this->getJson(gsPublicUrl($vehicle, '/updates?cursor='.gsCursor(['created_at' => 'x', 'id' => ['nested']])))->assertUnprocessable()->assertJsonValidationErrorFor('cursor');
        $this->getJson(gsPublicUrl($vehicle, '/updates?per_page=101'))->assertUnprocessable()->assertJsonValidationErrorFor('per_page');
    });

    it('has no raw SQL built from a variable in the garage code', function () {
        $files = collect(['Actions/Garage', 'Actions/Social', 'Services/Garage', 'Services/Search', 'Services/Qr', 'Http/Controllers/Api/V1/Garage', 'Http/Controllers/Api/V1/Public', 'Http/Controllers/Api/V1/Social'])
            ->flatMap(fn (string $directory) => File::allFiles(app_path($directory)));

        expect($files->count())->toBeGreaterThan(20);

        foreach ($files as $file) {
            preg_match_all('/(?:whereRaw|orWhereRaw|orderByRaw|selectRaw|havingRaw|groupByRaw|DB::raw|DB::statement|DB::unprepared|DB::select)\(\s*([^,)]*)/', $file->getContents(), $calls);

            foreach ($calls[1] as $sql) {
                expect($sql)->toMatch('/\A\'[^\'$]*\'\z/');
            }
        }
    });
});

describe('what search and the queue carry', function () {
    it('keeps notes, costs, part numbers and planned parts out of the search text', function () {
        $vehicle = publishedVehicle($this->owner);
        modIn($vehicle, 'exhaust', attributes: ['title' => 'Verbaut', 'status' => 'installed', 'notes' => 'GEHEIME-NOTIZ', 'cost_cents' => 7654321, 'part_number' => 'TEILENUMMER-1']);
        modIn($vehicle, 'exhaust', attributes: ['title' => 'NUR-GEPLANT', 'status' => 'planned']);

        app(VehicleSearchProjector::class)->rebuild($vehicle->id);

        $text = (string) VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('search_text');

        expect($text)->toContain('Verbaut')->not->toContain('GEHEIME-NOTIZ')->not->toContain('7654321')->not->toContain('TEILENUMMER-1')->not->toContain('NUR-GEPLANT');
    });

    it('queues an id and nothing about the member', function () {
        Queue::fake();
        $vehicle = publishedVehicle($this->owner, ['nickname' => 'Geheimer Name']);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['color' => 'Rot'])->assertOk();

        Queue::assertPushed(RebuildVehicleSearch::class, function (RebuildVehicleSearch $job) use ($vehicle): bool {
            $payload = serialize($job);

            return $job->vehicleId === $vehicle->id
                && ! str_contains($payload, $this->owner->email)
                && ! str_contains($payload, 'Geheimer Name')
                && ! str_contains($payload, 'App\\Models');
        });

        $constructor = (new ReflectionClass(ProcessMedia::class))->getConstructor();

        expect($constructor?->getNumberOfParameters())->toBe(1)
            ->and($constructor?->getParameters()[0]->getName())->toBe('mediaId')
            ->and((string) $constructor?->getParameters()[0]->getType())->toBe('string');
    });
});
