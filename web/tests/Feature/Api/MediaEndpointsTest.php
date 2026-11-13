<?php

use App\Actions\Media\DeleteAllMedia;
use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    $this->owner = User::factory()->create();
    $this->vehicle = Vehicle::factory()->for($this->owner, 'owner')->published()->create();
});

/**
 * @return array{file: UploadedFile}
 */
function photo(string $name = 'photo.jpg', ?string $bytes = null): array
{
    return ['file' => UploadedFile::fake()->createWithContent($name, $bytes ?? TestImages::jpeg(800, 600))];
}

/**
 * The authorisation matrix for member endpoints on a vehicle or its media.
 *
 * @return array<string, array{0: Closure(User): ?User, 1: int, 2: string|null}>
 */
function matrix(int $success): array
{
    return [
        'guest' => [fn (User $owner): ?User => null, 401, 'unauthenticated'],
        'owner' => [fn (User $owner): ?User => $owner, $success, null],
        'other member' => [fn (User $owner): ?User => User::factory()->create(), 403, 'forbidden'],
        'blocked member' => [function (User $owner): ?User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return $member;
        }, 403, 'forbidden'],
        'member who blocked the owner' => [function (User $owner): ?User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $owner->id]);

            return $member;
        }, 403, 'forbidden'],
    ];
}

function signIn(?User $user): void
{
    if ($user !== null) {
        Sanctum::actingAs($user);
    }
}

describe('POST vehicles/{id}/media', function () {
    it('applies the authorisation matrix', function (Closure $actor, int $status, ?string $code) {
        signIn($actor($this->owner));

        $response = $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", photo(), ['Accept' => 'application/json'])
            ->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
            expect(Media::query()->count())->toBe(0);
        }
    })->with(matrix(201));

    it('answers 404 for a deleted vehicle', function () {
        signIn($this->owner);
        $this->vehicle->delete();

        $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", photo(), ['Accept' => 'application/json'])
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    });

    it('refuses a restricted member with the until-date', function () {
        $until = now()->addDays(7)->startOfSecond();
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing, $until)->create();
        $vehicle = Vehicle::factory()->for($member, 'owner')->create();
        signIn($member);

        $this->withHeader('Accept-Language', 'de')
            ->post("/api/v1/vehicles/{$vehicle->id}/media", photo(), ['Accept' => 'application/json'])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted')
            ->assertJsonPath('until', $until->toIso8601String())
            ->assertJsonPath('message', 'Dein Konto ist für diese Aktion bis zum '.$until->copy()->setTimezone('Europe/Berlin')->format('d.m.Y, H:i').' Uhr eingeschränkt.');
    });

    it('refuses a suspended member', function () {
        $member = User::factory()->suspended()->create();
        $vehicle = Vehicle::factory()->for($member, 'owner')->create();
        signIn($member);

        $this->post("/api/v1/vehicles/{$vehicle->id}/media", photo(), ['Accept' => 'application/json'])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted');
    });

    it('stores the photo and answers with the resource shape', function () {
        signIn($this->owner);

        $response = $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", [
            ...photo(),
            'alt' => 'Von vorne',
            'focal_x' => 0.5,
            'focal_y' => 0.4,
            'category' => 'exterior',
        ], ['Accept' => 'application/json'])->assertCreated();

        $response->assertExactJsonStructure(['data' => [
            'id', 'status', 'category', 'width', 'height', 'blurhash', 'thumbhash', 'focal_x', 'focal_y', 'alt', 'sort', 'created_at',
            'variants' => ['*' => ['width', 'height', 'url']],
        ]]);

        $response->assertJsonPath('data.status', 'ready')
            ->assertJsonPath('data.category', 'exterior')
            ->assertJsonPath('data.alt', 'Von vorne')
            ->assertJsonPath('data.width', 800)
            ->assertJsonPath('data.height', 600)
            ->assertJsonPath('data.focal_y', 0.4)
            ->assertJsonPath('data.variants.0', ['width' => 320, 'height' => 240, 'url' => $response->json('data.variants.0.url')]);

        expect($response->getContent())->not->toContain('original')
            ->and($response->json('data.variants.0.url'))->toContain('/storage/media/')
            ->and($this->vehicle->refresh()->cover_media_id)->toBe($response->json('data.id'));
    });

    it('validates its input', function (array $payload, string $field) {
        signIn($this->owner);

        $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", $payload, ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrors($field);
    })->with([
        'no file' => [[], 'file'],
        'not a file' => [['file' => 'text'], 'file'],
        'focal out of range' => [fn () => [...photo(), 'focal_x' => 1.5, 'focal_y' => 0.5], 'focal_x'],
        'focal_x alone' => [fn () => [...photo(), 'focal_x' => 0.5], 'focal_y'],
        'unknown category' => [fn () => [...photo(), 'category' => 'nope'], 'category'],
        'long alt' => [fn () => [...photo(), 'alt' => str_repeat('a', 501)], 'alt'],
    ]);

    it('rejects a renamed non-image with 415 and stores nothing', function () {
        signIn($this->owner);

        $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", photo('shell.jpg', '<?php phpinfo();'), ['Accept' => 'application/json'])
            ->assertStatus(415)
            ->assertJsonPath('code', 'unsupported_media_type')
            ->assertJsonValidationErrors('file');

        expect(Media::withTrashed()->count())->toBe(0)
            ->and(Storage::disk('public')->allFiles())->toBe([]);
    });

    it('enforces the photo limit per vehicle', function () {
        signIn($this->owner);
        config(['speedclub.garage.max_photos_per_vehicle' => 2]);
        Media::factory()->count(2)->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);

        $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", photo(), ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('file');

        expect($this->vehicle->media()->count())->toBe(2);
    });

    it('does not count deleted or failed photos towards the limit', function () {
        signIn($this->owner);
        config(['speedclub.garage.max_photos_per_vehicle' => 1]);
        Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'deleted_at' => now()]);
        Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Failed]);

        $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", photo(), ['Accept' => 'application/json'])->assertCreated();
    });

    it('keeps the 30 photo limit from the spec in config', function () {
        expect(config('speedclub.garage.max_photos_per_vehicle'))->toBe(30)
            ->and(config('speedclub.media.max_upload_mb'))->toBe(15);
    });

    it('replays the first response for the same Idempotency-Key and stores one photo', function () {
        signIn($this->owner);
        $file = photo();
        $headers = ['Accept' => 'application/json', 'Idempotency-Key' => 'upload-1'];

        $first = $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", $file, $headers)->assertCreated();
        $replay = $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", $file, $headers)->assertCreated();

        expect($replay->json('data.id'))->toBe($first->json('data.id'))
            ->and($replay->headers->get('Idempotency-Replayed'))->toBe('true')
            ->and($this->vehicle->media()->count())->toBe(1);
    });

    it('throttles uploads with a friendly 429', function (string $locale, string $message) {
        config(['speedclub.rate_limits.uploads.max' => 1]);
        RateLimits::register();
        signIn($this->owner);

        $headers = ['Accept' => 'application/json', 'Accept-Language' => $locale];
        $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", [], $headers)->assertUnprocessable();

        $response = $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", [], $headers)
            ->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');

        expect($response->json('message'))->toContain($message);
    })->with([
        'de' => ['de', 'viele Fotos'],
        'en' => ['en', 'a lot of photos'],
    ]);
});

describe('PATCH media/{id}', function () {
    beforeEach(function () {
        $this->media = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
    });

    it('applies the authorisation matrix', function (Closure $actor, int $status, ?string $code) {
        signIn($actor($this->owner));

        $response = $this->patchJson("/api/v1/media/{$this->media->id}", ['alt' => 'Neu'])->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
            expect($this->media->refresh()->alt)->toBeNull();
        }
    })->with(matrix(200));

    it('refuses a restricted member', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $media = Media::factory()->create(['owner_id' => $member->id]);
        signIn($member);

        $this->patchJson("/api/v1/media/{$media->id}", ['alt' => 'Neu'])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted')
            ->assertJsonPath('until', null);
    });

    it('updates alt, focal point and category', function () {
        signIn($this->owner);

        $this->patchJson("/api/v1/media/{$this->media->id}", [
            'alt' => 'Felge', 'focal_x' => 0.1, 'focal_y' => 0.9, 'category' => 'wheels',
        ])
            ->assertOk()
            ->assertJsonPath('data.alt', 'Felge')
            ->assertJsonPath('data.focal_x', 0.1)
            ->assertJsonPath('data.category', 'wheels');

        expect($this->media->refresh()->category)->toBe(MediaCategory::Wheels);
    });

    it('cannot touch the pipeline fields', function () {
        signIn($this->owner);
        $status = $this->media->status;

        $this->patchJson("/api/v1/media/{$this->media->id}", [
            'alt' => 'x', 'status' => 'failed', 'owner_id' => User::factory()->create()->id, 'original_path' => 'x', 'variants' => [],
        ])->assertOk();

        $this->media->refresh();

        expect($this->media->status)->toBe($status)
            ->and($this->media->owner_id)->toBe($this->owner->id)
            ->and($this->media->original_path)->not->toBe('x')
            ->and($this->media->variants)->not->toBe([]);
    });

    it('validates its input', function (array $payload, string $field) {
        signIn($this->owner);

        $this->patchJson("/api/v1/media/{$this->media->id}", $payload)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'focal' => [['focal_x' => 2, 'focal_y' => 0], 'focal_x'],
        'focal pair' => [['focal_x' => 0.5], 'focal_y'],
        'category' => [['category' => 'nope'], 'category'],
        'alt' => [['alt' => str_repeat('a', 501)], 'alt'],
    ]);

    it('answers 404 for deleted media', function () {
        signIn($this->owner);
        $this->media->delete();

        $this->patchJson("/api/v1/media/{$this->media->id}", ['alt' => 'x'])->assertNotFound();
    });
});

describe('PUT vehicles/{id}/media/order', function () {
    beforeEach(function () {
        $this->photos = Media::factory()->count(3)->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
        $this->ids = $this->photos->pluck('id')->reverse()->values()->all();
    });

    it('applies the authorisation matrix', function (Closure $actor, int $status, ?string $code) {
        signIn($actor($this->owner));

        $response = $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/media/order", ['ids' => $this->ids])->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(matrix(200));

    it('refuses a restricted member', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = Vehicle::factory()->for($member, 'owner')->create();
        signIn($member);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/media/order", ['ids' => $this->ids])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted');
    });

    it('stores the new order', function () {
        signIn($this->owner);

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/media/order", ['ids' => $this->ids])
            ->assertOk()
            ->assertJsonPath('data.0.id', $this->ids[0])
            ->assertJsonPath('data.2.id', $this->ids[2])
            ->assertJsonPath('data.2.sort', 2);

        expect($this->vehicle->media()->orderBy('sort')->pluck('id')->all())->toBe($this->ids);
    });

    it('requires every photo of the vehicle exactly once', function (Closure $ids) {
        signIn($this->owner);

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/media/order", ['ids' => $ids($this)])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('ids');
    })->with([
        'missing one' => [fn ($test) => array_slice($test->ids, 1)],
        'foreign photo' => [fn ($test) => [...$test->ids, Media::factory()->create()->id]],
    ]);

    it('validates its input', function (array $payload, string $field) {
        signIn($this->owner);

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/media/order", $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors($field);
    })->with([
        'empty' => [['ids' => []], 'ids'],
        'not ulids' => [['ids' => ['x']], 'ids.0'],
    ]);

    it('rejects duplicates', function () {
        signIn($this->owner);

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/media/order", ['ids' => [$this->ids[0], $this->ids[0]]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('ids.0');
    });
});

describe('DELETE media/{id}', function () {
    beforeEach(function () {
        $this->media = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'sort' => 0]);
    });

    it('applies the authorisation matrix', function (Closure $actor, int $status, ?string $code) {
        signIn($actor($this->owner));

        $response = $this->deleteJson("/api/v1/media/{$this->media->id}")->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
            expect(Media::query()->whereKey($this->media->id)->exists())->toBeTrue();
        } else {
            $this->assertSoftDeleted($this->media);
        }
    })->with(matrix(204));

    it('stays open for a restricted member', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $media = Media::factory()->create(['owner_id' => $member->id]);
        signIn($member);

        $this->deleteJson("/api/v1/media/{$media->id}")->assertNoContent();
    });

    it('moves the cover to the next finished photo', function () {
        signIn($this->owner);
        Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'sort' => 1, 'status' => MediaStatus::Processing]);
        $next = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'sort' => 2]);
        $this->vehicle->forceFill(['cover_media_id' => $this->media->id])->save();

        $this->deleteJson("/api/v1/media/{$this->media->id}")->assertNoContent();

        expect($this->vehicle->refresh()->cover_media_id)->toBe($next->id);
    });

    it('clears the cover when no photo is left', function () {
        signIn($this->owner);
        $this->vehicle->forceFill(['cover_media_id' => $this->media->id])->save();

        $this->deleteJson("/api/v1/media/{$this->media->id}")->assertNoContent();

        expect($this->vehicle->refresh()->cover_media_id)->toBeNull();
    });

    it('leaves another cover alone', function () {
        signIn($this->owner);
        $cover = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
        $this->vehicle->forceFill(['cover_media_id' => $cover->id])->save();

        $this->deleteJson("/api/v1/media/{$this->media->id}")->assertNoContent();

        expect($this->vehicle->refresh()->cover_media_id)->toBe($cover->id);
    });

    it('clears a profile image that used the photo', function () {
        signIn($this->owner);
        $this->owner->forceFill(['avatar_media_id' => $this->media->id, 'cover_media_id' => $this->media->id])->save();

        $this->deleteJson("/api/v1/media/{$this->media->id}")->assertNoContent();

        $this->owner->refresh();

        expect($this->owner->avatar_media_id)->toBeNull()
            ->and($this->owner->cover_media_id)->toBeNull();
    });

    it('answers 404 the second time', function () {
        signIn($this->owner);

        $this->deleteJson("/api/v1/media/{$this->media->id}")->assertNoContent();
        $this->deleteJson("/api/v1/media/{$this->media->id}")->assertNotFound();
    });
});

/**
 * @return array{id: string, public: list<string>, original: string}
 */
function uploadedPhoto(Vehicle $vehicle): array
{
    $response = test()->post("/api/v1/vehicles/{$vehicle->id}/media", photo(), ['Accept' => 'application/json'])->assertCreated();
    $media = Media::query()->findOrFail($response->json('data.id'));

    return ['id' => $media->id, 'public' => array_values($media->variants), 'original' => $media->original_path];
}

describe('a deleted photo', function () {
    it('stops being public right away and keeps only the private original', function () {
        signIn($this->owner);
        $photo = uploadedPhoto($this->vehicle);

        foreach ($photo['public'] as $path) {
            Storage::disk('public')->assertExists($path);
        }

        $this->deleteJson("/api/v1/media/{$photo['id']}")->assertNoContent();

        // Apache serves /storage directly: no file means a 404 for the URL.
        foreach ($photo['public'] as $path) {
            Storage::disk('public')->assertMissing($path);
        }

        Storage::disk('local')->assertExists($photo['original']);

        expect(Media::withTrashed()->findOrFail($photo['id'])->variants)->toBeNull()
            ->and(Storage::disk('public')->allFiles())->toBe([]);
    });

    it('answers 404 at its old URL, which has no route to fall back on', function () {
        $this->get('/storage/media/01abc/1234-320.webp')->assertNotFound();

        expect(Route::has('storage.local'))->toBeFalse();
    });

    it('loses the original with the hard delete after 30 days', function () {
        signIn($this->owner);
        $photo = uploadedPhoto($this->vehicle);
        $this->deleteJson("/api/v1/media/{$photo['id']}")->assertNoContent();

        $this->travel(29)->days();
        $this->artisan('media:prune')->assertSuccessful();
        Storage::disk('local')->assertExists($photo['original']);

        $this->travel(2)->days();
        $this->artisan('media:prune')->assertSuccessful();
        Storage::disk('local')->assertMissing($photo['original']);

        expect(Media::withTrashed()->whereKey($photo['id'])->exists())->toBeFalse();
    });

    it('is withdrawn by media:prune when the first attempt failed', function () {
        signIn($this->owner);
        $photo = uploadedPhoto($this->vehicle);
        Media::query()->whereKey($photo['id'])->delete();

        Storage::disk('public')->assertExists($photo['public'][0]);

        $this->artisan('media:prune')->assertSuccessful();

        Storage::disk('public')->assertMissing($photo['public'][0]);
        Storage::disk('local')->assertExists($photo['original']);
    });

    it('stays unpublished when processing finishes after the delete', function () {
        $service = app(MediaService::class);
        $media = $service->reserve($this->owner, $this->vehicle);
        $media->delete();

        $service->process($media, TestImages::jpeg(800, 600));

        expect(Storage::disk('public')->allFiles())->toBe([])
            ->and($media->refresh()->variants)->toBeNull()
            ->and($this->vehicle->refresh()->cover_media_id)->toBeNull();
    });

    it('goes with the vehicle, including mod photos', function () {
        signIn($this->owner);
        $photo = uploadedPhoto($this->vehicle);
        $mod = Modification::factory()->create(['vehicle_id' => $this->vehicle->id]);
        $service = app(MediaService::class);
        $modPhoto = $service->processOrQueue($service->reserve($this->owner, $mod), TestImages::jpeg(800, 600));
        $kept = uploadedPhoto(Vehicle::factory()->for($this->owner, 'owner')->create());

        expect(app(DeleteAllMedia::class)->forVehicle($this->vehicle))->toBe(2);

        Storage::disk('public')->assertMissing($photo['public'][0]);
        Storage::disk('public')->assertMissing(array_values($modPhoto->variants)[0]);
        Storage::disk('public')->assertExists($kept['public'][0]);
    });

    it('goes with the member, and no one else loses a photo', function () {
        signIn($this->owner);
        $photo = uploadedPhoto($this->vehicle);
        $stranger = User::factory()->create();
        $service = app(MediaService::class);
        $theirs = $service->processOrQueue($service->reserve($stranger, Vehicle::factory()->for($stranger, 'owner')->create()), TestImages::jpeg(800, 600));

        expect(app(DeleteAllMedia::class)->forMember($this->owner))->toBe(1);

        Storage::disk('public')->assertMissing($photo['public'][0]);
        Storage::disk('public')->assertExists(array_values($theirs->variants)[0]);
    });
});

describe('a staff session', function () {
    it('is the only thing refused here: a member session gets through (control)', function () {
        $media = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
        $session = databaseSessionFor($this->owner, 'web');

        $this->withCredentials()
            ->withCookie(config()->string('session.cookie'), $session)
            ->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json'])
            ->deleteJson("/api/v1/media/{$media->id}")
            ->assertNoContent();
    });

    it('never authenticates the member API', function (string $method, Closure $path, string $cookie) {
        $media = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
        $session = databaseSessionFor(Staff::factory()->create(), 'staff');

        $this->withCredentials()
            ->withCookie($cookie === 'default' ? config()->string('session.cookie') : $cookie, $session)
            ->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json'])
            ->json($method, $path($this->vehicle, $media), ['alt' => 'Staff', 'ids' => [$media->id]])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'unauthenticated');

        expect($media->refresh()->alt)->toBeNull()
            ->and(Media::query()->whereKey($media->id)->exists())->toBeTrue();
    })->with([
        'upload' => ['POST', fn (Vehicle $vehicle, Media $media): string => "/api/v1/vehicles/{$vehicle->id}/media"],
        'update' => ['PATCH', fn (Vehicle $vehicle, Media $media): string => "/api/v1/media/{$media->id}"],
        'order' => ['PUT', fn (Vehicle $vehicle, Media $media): string => "/api/v1/vehicles/{$vehicle->id}/media/order"],
        'delete' => ['DELETE', fn (Vehicle $vehicle, Media $media): string => "/api/v1/media/{$media->id}"],
    ])->with(['default', 'sc_staff_session']);
});

describe('text that cannot be stored', function () {
    it('answers 422 instead of a 500', function (string $value) {
        signIn($this->owner);
        $media = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);

        $this->call('PATCH', "/api/v1/media/{$media->id}", ['alt' => $value], [], [], ['HTTP_ACCEPT' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrors('alt');

        expect($media->refresh()->alt)->toBeNull();
    })->with([
        'invalid UTF-8' => ["kaputt \xFF\xFE"],
        'truncated multibyte' => ["caf\xC3"],
        'NUL byte' => ["a\0b"],
    ]);

    it('names a nested field', function () {
        signIn($this->owner);

        $this->call('PUT', "/api/v1/vehicles/{$this->vehicle->id}/media/order", ['ids' => ['ok', "\xFF"]], [], [], ['HTTP_ACCEPT' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('ids.1');
    });

    it('rejects a JSON body that is not valid, which would otherwise read as empty', function () {
        signIn($this->owner);
        $media = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);

        $this->call('PATCH', "/api/v1/media/{$media->id}", [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'], "{\"alt\":\"\xFF\"}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('body');
    });

    it('rejects it on the catalogue and in the query string too', function () {
        Sanctum::actingAs($this->owner);

        $this->call('POST', '/api/v1/catalog/requests', ['make_text' => "\xFF"], [], [], ['HTTP_ACCEPT' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('make_text');

        $this->getJson('/api/v1/catalog/brands?category=%FF')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('category');
    });

    it('answers in the language of the request', function (string $locale, string $message) {
        signIn($this->owner);
        $media = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);

        $this->call('PATCH', "/api/v1/media/{$media->id}", ['alt' => "\xFF"], [], [], ['HTTP_ACCEPT' => 'application/json', 'HTTP_ACCEPT_LANGUAGE' => $locale])
            ->assertJsonPath('errors.alt.0', $message);
    })->with([
        'de' => ['de', 'Das enthält Zeichen, die wir nicht speichern können.'],
        'en' => ['en', 'This contains characters we cannot store.'],
    ]);

    it('leaves emoji and umlauts alone', function () {
        signIn($this->owner);
        $media = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);

        $this->patchJson("/api/v1/media/{$media->id}", ['alt' => 'Größe 🚗'])->assertOk()->assertJsonPath('data.alt', 'Größe 🚗');
    });

    it('keeps the staff login from failing', function () {
        $this->post('/admin/login', ['email' => "\xFF", 'password' => 'x'])->assertRedirect();
    });
});
