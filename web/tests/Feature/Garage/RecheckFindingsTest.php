<?php

use App\Actions\Garage\UploadModificationMedia;
use App\Actions\Media\DeleteMedia;
use App\Enums\MediaStatus;
use App\Enums\RestrictionType;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\ImageProcessor;
use App\Services\Media\MediaService;
use App\Services\Media\ProcessMedia;
use App\Services\PublicPages\DrawVehicleOgImage;
use App\Services\Search\VehicleSearchProjector;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/GarageTestHelpers.php';

/**
 * What the re-check of the Phase 1 bug fixes found on the server (docs/reports/phase-1/bug-hunt.md, re-check round).
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);

    // A build stamped long ago, behind a stranger's newer one in "Neue Builds".
    $this->at = CarbonImmutable::parse('2026-01-15 10:00:00');
    $this->travelTo($this->at);
    $this->vehicle = publishedVehicle($this->owner);
    $this->stranger = publishedVehicle(User::factory()->create());
    $this->stranger->forceFill(['updated_at' => $this->at->addMonths(3)])->save();
    $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at, 'og_image_path' => 'og/vehicles/card.jpg']);
    $this->vehicle->refresh();
    $this->rebuild = function (): void {
        app(VehicleSearchProjector::class)->rebuild($this->vehicle->id);
        app(VehicleSearchProjector::class)->rebuild($this->stranger->id);
    };
    ($this->rebuild)();
    $this->stamp = fn (): string => (string) DB::table('vehicles')->where('id', $this->vehicle->id)->value('updated_at');
    $this->stampOfSearch = fn (): string => (string) DB::table('vehicle_search')->where('vehicle_id', $this->vehicle->id)->value('updated_at');
    $this->order = fn (): array => collect($this->getJson('/api/v1/home/new-builds')->assertOk()->json('data'))->pluck('id')->all();
    $this->travelTo($this->at->addMonths(6));
});

/**
 * Processing fails for a reason on our side: the upload answers 201 processing and waits for the queue.
 */
function recheckBrokenStorage(): void
{
    $broken = Mockery::mock(ImageProcessor::class);
    $broken->shouldReceive('process')->andThrow(new RuntimeException('disk full'));
    app()->instance(MediaService::class, new MediaService($broken));
    Exceptions::fake();
}

describe('ADR-176(a): publish is a no-op on a published vehicle', function () {
    it('answers 200 with the vehicle to a second publish with a new key, and changes nothing', function () {
        $draft = completeDraft($this->owner);
        Sanctum::actingAs($this->owner);
        Queue::fake();
        $this->withHeader('Idempotency-Key', 'pub-1')->postJson("/api/v1/vehicles/{$draft->id}/publish")->assertOk();
        // The member chose Privat after the lost answer, then tapped Veröffentlichen again.
        $this->patchJson("/api/v1/vehicles/{$draft->id}/visibility", ['visibility' => 'private'])->assertOk();

        $draft->refresh();
        $before = DB::table('vehicles')->where('id', $draft->id)->first();
        $history = BuildUpdate::query()->where('vehicle_id', $draft->id)->count();
        $codes = $draft->qrCodes()->count();
        $this->travel(5)->minutes();
        Queue::fake();

        $this->withHeader('Idempotency-Key', 'pub-2')->postJson("/api/v1/vehicles/{$draft->id}/publish", ['visibility' => 'public'])
            ->assertOk()
            ->assertJsonPath('data.id', $draft->id)
            ->assertJsonPath('data.status', 'published')
            ->assertJsonPath('data.visibility', 'private');

        Queue::assertNothingPushed();
        expect(DB::table('vehicles')->where('id', $draft->id)->first())->toEqual($before)
            ->and(BuildUpdate::query()->where('vehicle_id', $draft->id)->count())->toBe($history)
            ->and($draft->qrCodes()->count())->toBe($codes);
    });

    it('still refuses everybody else, and the owner whatever else forbids it', function (Closure $who, int $status, ?string $code) {
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $before = DB::table('vehicles')->where('id', $this->vehicle->id)->first();
        $response = $this->withHeader('Idempotency-Key', 'pub-x')->postJson("/api/v1/vehicles/{$this->vehicle->id}/publish")->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }

        expect(DB::table('vehicles')->where('id', $this->vehicle->id)->first())->toEqual($before);
    })->with([
        'guest' => [fn (User $owner) => null, 401, 'unauthenticated'],
        'stranger' => [fn (User $owner) => User::factory()->create(), 403, 'forbidden'],
        'owner under a publishing restriction' => [function (User $owner) {
            $owner->forceFill(User::factory()->restrictedFrom(RestrictionType::Publishing)->make()->only(['restrictions']))->save();

            return $owner->refresh();
        }, 403, 'account_restricted'],
        'suspended owner' => [function (User $owner) {
            $owner->forceFill(User::factory()->suspended()->make()->only(['status', 'restrictions']))->save();

            return $owner->refresh();
        }, 403, 'account_restricted'],
        'owner with an unverified address' => [function (User $owner) {
            $owner->forceFill(['email_verified_at' => null])->save();

            return $owner->refresh();
        }, 403, 'email_not_verified'],
    ]);

    it('refuses a deleted vehicle', function () {
        $this->vehicle->delete();
        Sanctum::actingAs($this->owner);

        $this->withHeader('Idempotency-Key', 'pub-y')->postJson("/api/v1/vehicles/{$this->vehicle->id}/publish")->assertNotFound();
    });
});

describe('a visibility flip is no change of the build', function () {
    it('leaves updated_at and the place in Neue Builds alone through public, private and public again', function () {
        $stamp = ($this->stamp)();
        $stampOfSearch = ($this->stampOfSearch)();
        $before = ($this->order)();
        Sanctum::actingAs($this->owner);

        expect($before[0])->toBe($this->stranger->id);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/visibility", ['visibility' => 'private'])->assertOk()->assertJsonPath('data.visibility', 'private');
        expect(($this->order)())->not->toContain($this->vehicle->id);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/visibility", ['visibility' => 'unlisted'])->assertOk();
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/visibility", ['visibility' => 'public'])->assertOk()->assertJsonPath('data.visibility', 'public');
        ($this->rebuild)();

        expect(($this->stamp)())->toBe($stamp)
            ->and(($this->stampOfSearch)())->toBe($stampOfSearch)
            ->and(($this->order)())->toBe($before)
            ->and(Vehicle::query()->findOrFail($this->vehicle->id)->visibility->value)->toBe('public');
    });
});

describe('a mod photo uploaded while the vehicle is deleted', function () {
    it('is refused with 404 once the delete has committed, as on the gallery, and leaves no row', function () {
        $mod = modIn($this->vehicle, 'exhaust');
        // What the delete left behind when the upload got past the route and the policy first: the vehicle gone, the mod still live.
        Vehicle::query()->whereKey($this->vehicle->id)->toBase()->update(['deleted_at' => now()]);
        $file = UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300));

        expect(fn () => app(UploadModificationMedia::class)->handle($this->owner, $mod->fresh(), $file, []))->toThrow(ModelNotFoundException::class)
            ->and(Media::withTrashed()->where('mediable_id', $mod->id)->count())->toBe(0)
            ->and(Storage::disk('public')->allFiles())->toBe([]);
    });

    it('locks the member, then the vehicle, then the modification', function () {
        $mod = modIn($this->vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);
        $locks = [];
        DB::listen(function ($query) use (&$locks): void {
            if (str_contains($query->sql, 'for update') && preg_match('/from [`"]?(\w+)/', $query->sql, $match) === 1) {
                $locks[] = $match[1];
            }
        });

        $this->post("/api/v1/mods/{$mod->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->assertCreated();

        expect(array_slice($locks, 0, 3))->toBe(['users', 'vehicles', 'modifications']);
    });
});

describe('only a photo that others can see gives the build a new time', function () {
    it('leaves the build alone when a gallery upload only reaches the retry queue, and when the retries run out', function () {
        recheckBrokenStorage();
        Queue::fake();
        Sanctum::actingAs($this->owner);
        $stamp = ($this->stamp)();

        $id = $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'processing')
            ->json('data.id');

        expect(($this->stamp)())->toBe($stamp);
        Queue::assertPushed(ProcessMedia::class);

        (new ProcessMedia($id))->failed(new RuntimeException('disk full'));
        ($this->rebuild)();

        expect(($this->stamp)())->toBe($stamp)
            ->and(Media::query()->findOrFail($id)->status)->toBe(MediaStatus::Failed)
            ->and(($this->order)()[0])->toBe($this->stranger->id);
    });

    it('leaves the build alone when a mod upload only reaches the retry queue', function () {
        $mod = modIn($this->vehicle, 'exhaust');
        $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at]);
        recheckBrokenStorage();
        Queue::fake();
        Sanctum::actingAs($this->owner);
        $stamp = ($this->stamp)();

        $this->post("/api/v1/mods/{$mod->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'processing');

        expect(($this->stamp)())->toBe($stamp);
    });

    it('still stamps the build when the upload is ready in the request', function (bool $ofMod) {
        $mod = modIn($this->vehicle, 'exhaust');
        $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at]);
        Sanctum::actingAs($this->owner);
        $stamp = ($this->stamp)();
        $url = $ofMod ? "/api/v1/mods/{$mod->id}/media" : "/api/v1/vehicles/{$this->vehicle->id}/media";

        $this->post($url, ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'ready');

        expect(($this->stamp)())->not->toBe($stamp);
    })->with(['gallery' => false, 'modification' => true]);

    it('leaves the build alone when a tile still processing is deleted, but takes the share card down', function (bool $ofMod) {
        $mod = modIn($this->vehicle, 'exhaust');
        $parent = $ofMod ? $mod : $this->vehicle;
        $row = Media::factory()->forModel($parent)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Processing, 'variants' => null, 'sort' => 5]);
        $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at]);
        $stamp = ($this->stamp)();
        Sanctum::actingAs($this->owner);
        Queue::fake();

        $this->deleteJson("/api/v1/media/{$row->id}")->assertNoContent();

        expect(($this->stamp)())->toBe($stamp)
            ->and($row->fresh()->trashed())->toBeTrue();

        if (! $ofMod) {
            // It may have turned ready and gone into the card meanwhile: the card is drawn again from what is left.
            Queue::assertPushed(DrawVehicleOgImage::class);
            expect(DB::table('vehicles')->where('id', $this->vehicle->id)->value('og_image_path'))->toBeNull();
        }
    })->with(['gallery' => false, 'modification' => true]);

    it('counts a tile that turned ready before the delete as a change of the build', function () {
        $row = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Processing, 'variants' => null, 'sort' => 5]);
        $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at]);
        $stamp = ($this->stamp)();
        $seen = Media::query()->findOrFail($row->id);
        // The queue finished it after the route read it.
        Media::query()->whereKey($row->id)->toBase()->update(['status' => MediaStatus::Ready->value]);
        Queue::fake();

        app(DeleteMedia::class)->handle($seen);

        Queue::assertPushed(DrawVehicleOgImage::class);
        expect(($this->stamp)())->not->toBe($stamp)
            ->and(DB::table('vehicles')->where('id', $this->vehicle->id)->value('og_image_path'))->toBeNull();
    });
});

describe('a photo deleted while the queue processes it (recheck round 3)', function () {
    /**
     * A row that answered 201 processing, and a queue run during which the member deletes it (or the row is already purged).
     */
    function r3ProcessingRow(mixed $test, bool $ofMod): string
    {
        $mod = modIn($test->vehicle, 'exhaust');
        $test->vehicle->newQuery()->whereKey($test->vehicle->id)->toBase()->update(['updated_at' => $test->at]);
        recheckBrokenStorage();
        Queue::fake();
        Sanctum::actingAs($test->owner);
        $url = $ofMod ? "/api/v1/mods/{$mod->id}/media" : "/api/v1/vehicles/{$test->vehicle->id}/media";

        return $test->post($url, ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'processing')
            ->json('data.id');
    }

    function r3QueueThatSeesADelete(string $id, Closure $delete): MediaService
    {
        $real = new ImageProcessor;
        $processor = Mockery::mock(ImageProcessor::class);
        $processor->shouldReceive('process')->andReturnUsing(function (string $bytes) use ($real, $id, $delete) {
            $delete(Media::query()->findOrFail($id));

            return $real->process($bytes);
        });

        return new MediaService($processor);
    }

    it('gives the build no new time, no history entry and no share card', function (bool $ofMod, string $how) {
        $id = r3ProcessingRow($this, $ofMod);
        $stamp = ($this->stamp)();
        $searchStamp = ($this->stampOfSearch)();
        $history = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count();
        $this->travel(1)->hours();
        Queue::fake();

        $service = r3QueueThatSeesADelete($id, fn (Media $row) => $how === 'soft'
            ? app(DeleteMedia::class)->handle($row)
            : $row->forceDelete());

        (new ProcessMedia($id))->handle($service);

        expect(($this->stamp)())->toBe($stamp)
            ->and(($this->stampOfSearch)())->toBe($searchStamp)
            ->and(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe($history)
            ->and(Storage::disk('public')->allFiles())->toBe([])
            ->and(DB::table('vehicles')->where('id', $this->vehicle->id)->value('cover_media_id'))->not->toBe($id);

        // A soft delete of a processing tile may redraw the card from what is left (DeleteMedia); ProcessMedia adds nothing.
        Queue::assertPushed(DrawVehicleOgImage::class, $how === 'soft' && ! $ofMod ? 1 : 0);
    })->with(['gallery' => false, 'modification' => true])->with(['soft', 'purged']);

    it('still stamps the build when the row is live at the end', function (bool $ofMod) {
        $id = r3ProcessingRow($this, $ofMod);
        $stamp = ($this->stamp)();
        $this->travel(1)->hours();
        app()->forgetInstance(MediaService::class);

        (new ProcessMedia($id))->handle(app(MediaService::class));

        expect(Media::query()->findOrFail($id)->status)->toBe(MediaStatus::Ready)
            ->and(($this->stamp)())->not->toBe($stamp);
    })->with(['gallery' => false, 'modification' => true]);
});
