<?php

use App\Actions\Garage\DeleteVehicle;
use App\Actions\Garage\PublishVehicle;
use App\Actions\Garage\ReorderVehicles;
use App\Actions\Garage\SetMainVehicle;
use App\Actions\Media\DeleteMedia;
use App\Actions\Media\SweepDetachedMedia;
use App\Enums\MediaStatus;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Models\Media;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\HomeFeed;
use App\Services\Media\ImageProcessor;
use App\Services\Media\MediaService;
use App\Services\PublicPages\DrawVehicleOgImage;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use App\Services\Search\VehicleSearchProjector;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * The media findings of the Phase 1 bug hunt (docs/reports/phase-1/bug-hunt.md).
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
});

function bhFailedPhoto(Vehicle $vehicle): Media
{
    return Media::factory()->forModel($vehicle)->create([
        'owner_id' => $vehicle->owner_id,
        'status' => MediaStatus::Failed,
        'variants' => null,
        'width' => null,
        'height' => null,
        'blurhash' => null,
        'sort' => 99,
    ]);
}

describe('BH-46 part 1: a failed row does not block sorting', function () {
    beforeEach(function () {
        $this->vehicle = publishedVehicle($this->owner);
        $this->second = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'sort' => 1]);
        $this->first = $this->vehicle->media()->whereKeyNot($this->second->id)->firstOrFail();
        $this->failed = bhFailedPhoto($this->vehicle);
        Sanctum::actingAs($this->owner);
        $this->url = "/api/v1/vehicles/{$this->vehicle->id}/media/order";
    });

    it('sorts what the member sees, and leaves the failed row where it is', function () {
        $ids = $this->putJson($this->url, ['ids' => [$this->second->id, $this->first->id]])->assertOk()->json('data.*.id');

        expect($ids)->toBe([$this->second->id, $this->first->id])
            ->and($this->second->fresh()->getAttribute('sort'))->toBe(0)
            ->and($this->first->fresh()->getAttribute('sort'))->toBe(1)
            ->and($this->failed->fresh()->getAttribute('sort'))->toBe(99);
    });

    it('does not take the failed row into the order', function () {
        $this->putJson($this->url, ['ids' => [$this->failed->id, $this->second->id, $this->first->id]])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor('ids');
    });

    it('still refuses a list that leaves a real photo out', function () {
        $this->putJson($this->url, ['ids' => [$this->first->id]])->assertUnprocessable()->assertJsonValidationErrorFor('ids');
    });
});

describe('BH-46 part 2: media:prune removes failed rows after a while', function () {
    beforeEach(function () {
        $this->vehicle = publishedVehicle($this->owner);
        $this->failed = bhFailedPhoto($this->vehicle);
    });

    it('keeps them for the member to see, for the configured days', function () {
        expect(config('speedclub.media.failed_prune_days'))->toBe(30);

        $this->travel(29)->days();
        Artisan::call('media:prune');

        expect(Media::withTrashed()->whereKey($this->failed->id)->exists())->toBeTrue();
    });

    it('removes them after that, with nothing left behind, and leaves the rest', function () {
        $this->travel(31)->days();
        Artisan::call('media:prune');

        expect(Media::withTrashed()->whereKey($this->failed->id)->exists())->toBeFalse()
            ->and($this->vehicle->media()->usablePhoto()->count())->toBe(1);
    });
});

describe('BH-46 part 3: the owner\'s edit view tells about a failed photo', function () {
    beforeEach(function () {
        $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline']);
        $this->photo = $this->vehicle->media()->firstOrFail();
        $this->failed = bhFailedPhoto($this->vehicle);
        app(VehicleSearchProjector::class)->rebuild($this->vehicle->id);
    });

    it('shows the owner the failed row on the vehicle that GAR-07 reads, beside the photos', function () {
        Sanctum::actingAs($this->owner);

        $data = $this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->json('data');

        expect(collect($data['failed_photos'])->pluck('id')->all())->toBe([$this->failed->id])
            ->and($data['failed_photos'][0]['status'])->toBe('failed')
            ->and($data['failed_photos'][0]['variants'])->toBe([])
            ->and(collect($data['photos'])->pluck('id')->all())->toBe([$this->photo->id])
            ->and($data['photo_count'])->toBe(1);
    });

    it('keeps it in every answer of that shape, so a saved form does not make the tile vanish', function () {
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['color' => 'Blau'])
            ->assertOk()
            ->assertJsonPath('data.failed_photos.0.id', $this->failed->id);
    });

    it('lets the owner delete the failed row', function () {
        Sanctum::actingAs($this->owner);

        $this->deleteJson("/api/v1/media/{$this->failed->id}")->assertNoContent();

        expect($this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->json('data.failed_photos'))->toBe([]);
    });

    it('has no failed row for anybody else on that route', function () {
        Sanctum::actingAs(User::factory()->create());

        expect($this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->json('data.failed_photos'))->toBe([]);
    });

    it('is not on the public read, for a guest or for the owner', function (bool $asOwner) {
        if ($asOwner) {
            Sanctum::actingAs($this->owner);
        }

        $response = $this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug())->assertOk();

        expect(collect($response->json('data.photos'))->pluck('id')->all())->toBe([$this->photo->id])
            ->and($response->json('data.photo_count'))->toBe(1)
            ->and($response->json('data'))->not->toHaveKey('failed_photos')
            ->and($response->getContent())->not->toContain($this->failed->id);
    })->with(['guest' => false, 'owner' => true]);

    it('is not on the Blade page', function () {
        expect($this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent())->not->toContain($this->failed->id);
    });

    it('is not on the owner\'s garage card or a feed', function () {
        Sanctum::actingAs($this->owner);

        $card = $this->getJson('/api/v1/me/vehicles')->assertOk();

        expect($card->json('data.0.photo_count'))->toBe(1)
            ->and($card->json('data.0'))->not->toHaveKey('failed_photos')
            ->and($card->getContent())->not->toContain($this->failed->id);

        $feed = $this->getJson('/api/v1/home/new-builds')->assertOk();

        expect($feed->json('data.0.id'))->toBe($this->vehicle->id)
            ->and($feed->json('data.0'))->not->toHaveKey('failed_photos')
            ->and($feed->getContent())->not->toContain($this->failed->id);
    });

    it('does not lift a build without a real photo into the featured slot', function () {
        $this->photo->delete();

        $featured = app(HomeFeed::class)->featured(null);

        expect(collect($featured)->pluck('vehicle.id')->all())->not->toContain($this->vehicle->id);
    });

    it('never becomes the cover', function () {
        $this->photo->forceDelete();
        $this->vehicle->forceFill(['cover_media_id' => null])->save();
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['cover_media_id' => $this->failed->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor('cover_media_id');

        $data = $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['cover_media_id' => null])->assertOk()->json('data');

        expect($data['cover_media_id'])->toBeNull()
            ->and($data['cover'])->toBeNull();
    });

    it('does not count towards completeness', function () {
        $this->photo->delete();
        Sanctum::actingAs($this->owner);

        $missing = collect($this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->json('data.completeness.missing'))->pluck('key');

        expect($missing)->toContain('photo');
    });

    it('does not satisfy the publish check', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'model_year' => 2020]);
        bhFailedPhoto($draft);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$draft->id}/publish")
            ->assertUnprocessable()
            ->assertJsonPath('code', 'vehicle_incomplete')
            ->assertJsonValidationErrorFor('photo');
    });

    it('stays hidden on a modification, which has no such tile', function () {
        $mod = modIn($this->vehicle, 'exhaust');
        $failed = bhFailedPhoto($this->vehicle);
        $failed->forceFill(['mediable_type' => $mod->getMorphClass(), 'mediable_id' => $mod->id])->save();
        Sanctum::actingAs($this->owner);

        expect($this->getJson("/api/v1/mods/{$mod->id}")->assertOk()->json('data.photos'))->toBe([]);
    });
});

describe('BH-44 and BH-46: clearing a photo nobody could see is housekeeping', function () {
    beforeEach(function () {
        $this->at = CarbonImmutable::parse('2026-01-15 10:00:00');
        $this->travelTo($this->at);
        $this->vehicle = publishedVehicle($this->owner);
        $this->mod = modIn($this->vehicle, 'exhaust');
        $this->stranger = publishedVehicle(User::factory()->create());
        $this->stranger->forceFill(['updated_at' => $this->at->addMonths(3)])->save();
        $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at, 'og_image_path' => 'og/vehicles/card.jpg']);
        $this->search = app(VehicleSearchProjector::class);
        $this->rebuild = function (): void {
            $this->search->rebuild($this->vehicle->id);
            $this->search->rebuild($this->stranger->id);
        };
        ($this->rebuild)();
        $this->stamp = fn (): string => (string) DB::table('vehicles')->where('id', $this->vehicle->id)->value('updated_at');
        $this->stampOfSearch = fn (): string => (string) DB::table('vehicle_search')->where('vehicle_id', $this->vehicle->id)->value('updated_at');
        $this->order = fn (): array => collect($this->getJson('/api/v1/home/new-builds')->assertOk()->json('data'))->pluck('id')->all();
        $this->travelTo($this->at->addMonths(6));
        Sanctum::actingAs($this->owner);
    });

    it('leaves the stamps, the place in Neue Builds and the share card alone', function () {
        $row = bhFailedPhoto($this->vehicle);
        $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at]);
        $stamp = ($this->stamp)();
        $stampOfSearch = ($this->stampOfSearch)();
        $before = ($this->order)();

        expect($before[0])->toBe($this->stranger->id);

        Queue::fake();
        $this->deleteJson("/api/v1/media/{$row->id}")->assertNoContent();

        Queue::assertNotPushed(DrawVehicleOgImage::class);
        Queue::fake([]);
        ($this->rebuild)();

        expect(($this->stamp)())->toBe($stamp)
            ->and(($this->stampOfSearch)())->toBe($stampOfSearch)
            ->and(($this->order)())->toBe($before)
            ->and(DB::table('vehicles')->where('id', $this->vehicle->id)->value('og_image_path'))->toBe('og/vehicles/card.jpg')
            ->and($row->fresh()->trashed())->toBeTrue();
    });

    it('does the same for a failed photo of a modification', function () {
        $row = bhFailedPhoto($this->vehicle);
        $row->forceFill(['mediable_type' => $this->mod->getMorphClass(), 'mediable_id' => $this->mod->id])->save();
        $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at]);
        $stamp = ($this->stamp)();

        $this->deleteJson("/api/v1/media/{$row->id}")->assertNoContent();

        expect(($this->stamp)())->toBe($stamp);
    });

    it('still counts deleting a real photo as a change of the build', function () {
        $photo = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'sort' => 1]);
        $this->vehicle->newQuery()->whereKey($this->vehicle->id)->toBase()->update(['updated_at' => $this->at]);
        $stamp = ($this->stamp)();

        Queue::fake();
        $this->deleteJson("/api/v1/media/{$photo->id}")->assertNoContent();

        Queue::assertPushed(DrawVehicleOgImage::class);
        expect(($this->stamp)())->not->toBe($stamp)
            ->and(DB::table('vehicles')->where('id', $this->vehicle->id)->value('og_image_path'))->toBeNull();
    });
});

describe('BH-47: one lock order', function () {
    /**
     * The statements that take a row lock, in order.
     *
     * @return list<string>
     */
    function bhLocks(Closure $work): array
    {
        $locks = [];
        DB::listen(function ($query) use (&$locks): void {
            if (str_contains($query->sql, 'for update') && preg_match('/from [`"]?(\w+)/', $query->sql, $match) === 1) {
                $locks[] = $match[1];
            }
        });

        $work();

        return $locks;
    }

    it('locks the member before the vehicle when a photo is uploaded', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $locks = bhLocks(fn () => $this->post("/api/v1/vehicles/{$vehicle->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->assertCreated());

        expect(array_slice($locks, 0, 2))->toBe(['users', 'vehicles']);
    });

    it('locks the member, then the vehicle, then the modification when a mod photo is uploaded', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $locks = bhLocks(fn () => $this->post("/api/v1/mods/{$mod->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->assertCreated());

        expect(array_slice($locks, 0, 3))->toBe(['users', 'vehicles', 'modifications']);
    });

    it('takes the same order in what the upload raced with', function (Closure $action) {
        $vehicle = completeDraft($this->owner);
        $published = publishedVehicle($this->owner);

        $locks = bhLocks(fn () => $action($this->owner, $vehicle, $published));

        expect($locks[0])->toBe('users');
    })->with([
        'publish' => [fn (User $owner, Vehicle $draft) => app(PublishVehicle::class)->handle($owner, $draft)],
        'set main' => [fn (User $owner, Vehicle $draft, Vehicle $published) => app(SetMainVehicle::class)->handle($owner, $published)],
        'delete' => [fn (User $owner, Vehicle $draft, Vehicle $published) => app(DeleteVehicle::class)->handle($owner, $published)],
        'reorder' => [fn (User $owner, Vehicle $draft, Vehicle $published) => app(ReorderVehicles::class)->handle($owner, [$published->id])],
    ]);

    it('retries a deadlock in what can safely run twice', function (Closure $action) {
        $vehicle = completeDraft($this->owner);
        $published = publishedVehicle($this->owner);
        $attempts = [];
        $real = DB::connection();
        DB::shouldReceive('transaction')->andReturnUsing(function (Closure $work, int $tries = 1) use (&$attempts, $real) {
            $attempts[] = $tries;

            return $real->transaction($work);
        });
        DB::shouldReceive('afterCommit')->andReturnUsing(fn (callable $work) => null);
        DB::shouldReceive('connection')->andReturn($real);

        $action($this->owner, $vehicle, $published);

        expect($attempts[0])->toBe(3);
    })->with([
        'publish' => [fn (User $owner, Vehicle $draft) => app(PublishVehicle::class)->handle($owner, $draft)],
        'set main' => [fn (User $owner, Vehicle $draft, Vehicle $published) => app(SetMainVehicle::class)->handle($owner, $published)],
        'delete' => [fn (User $owner, Vehicle $draft, Vehicle $published) => app(DeleteVehicle::class)->handle($owner, $published)],
        'reorder' => [fn (User $owner, Vehicle $draft, Vehicle $published) => app(ReorderVehicles::class)->handle($owner, [$published->id])],
    ]);
});

describe('BH-49: a request that died after the commit leaves nothing public', function () {
    /**
     * A vehicle with three gallery photos and one mod photo, whose files really are on the disk.
     */
    function bhVehicleWithFiles(User $owner): array
    {
        $vehicle = publishedVehicle($owner);
        $mod = modIn($vehicle, 'exhaust');
        Media::factory()->forModel($vehicle)->count(2)->create(['owner_id' => $owner->id]);
        Media::factory()->forModel($mod)->create(['owner_id' => $owner->id]);

        $photos = Media::query()->where('owner_id', $owner->id)->get();

        foreach ($photos as $photo) {
            foreach ($photo->getAttribute('variants') as $path) {
                Storage::disk('public')->put($path, 'x');
            }

            Storage::disk('local')->put($photo->getAttribute('original_path'), 'x');
        }

        return [$vehicle, $mod, $photos];
    }

    function bhPublicFileCount(iterable $photos): int
    {
        $files = 0;

        foreach ($photos as $photo) {
            $photo = Media::withTrashed()->find($photo->id);

            foreach ($photo?->getAttribute('variants') ?? [] as $path) {
                $files += Storage::disk('public')->exists($path) ? 1 : 0;
            }
        }

        return $files;
    }

    /**
     * Throws on the second photo, as a host limit or a storage fault would.
     */
    function bhDyingDelete(): void
    {
        app()->bind(DeleteMedia::class, fn ($app) => new class($app->make(MediaService::class), $app->make(VehicleSearchProjector::class), $app->make(OgImages::class)) extends DeleteMedia
        {
            private int $calls = 0;

            public function handle(Media $media): void
            {
                if (++$this->calls === 2) {
                    throw new RuntimeException('Killed in the middle of the loop.');
                }

                parent::handle($media);
            }
        });
    }

    it('catches up on the next media:prune after DELETE died partway', function () {
        [$vehicle, , $photos] = bhVehicleWithFiles($this->owner);
        bhDyingDelete();
        Sanctum::actingAs($this->owner);
        $this->withoutExceptionHandling();

        expect(fn () => $this->deleteJson("/api/v1/vehicles/{$vehicle->id}"))->toThrow(RuntimeException::class);

        app()->forgetInstance(DeleteMedia::class);
        app()->offsetUnset(DeleteMedia::class);

        expect(Vehicle::withTrashed()->find($vehicle->id)->trashed())->toBeTrue()
            ->and(Media::query()->where('owner_id', $this->owner->id)->count())->toBeGreaterThan(0)
            ->and(bhPublicFileCount($photos))->toBeGreaterThan(0);

        Artisan::call('media:prune');

        expect(Media::query()->where('owner_id', $this->owner->id)->count())->toBe(0)
            ->and(bhPublicFileCount($photos))->toBe(0);

        // The originals go with the hard delete, as for any deleted photo.
        $this->travel(32)->days();
        Artisan::call('media:prune');
        Artisan::call('vehicles:prune');

        expect(Media::withTrashed()->where('owner_id', $this->owner->id)->count())->toBe(0)
            ->and(Vehicle::withTrashed()->find($vehicle->id))->toBeNull();
    });

    it('reaches a mod photo too, of a mod that went with the vehicle or before it', function () {
        [$vehicle, $mod, $photos] = bhVehicleWithFiles($this->owner);
        $mod->delete();
        $vehicle->delete();

        Artisan::call('media:prune');

        expect(bhPublicFileCount($photos))->toBe(0);
    });

    it('sweeps the photos of a deleted modification of a live vehicle', function () {
        [$vehicle, $mod, $photos] = bhVehicleWithFiles($this->owner);
        $photo = $mod->media()->firstOrFail();
        $mod->delete();

        Artisan::call('media:prune');

        expect(Media::query()->whereKey($photo->id)->exists())->toBeFalse()
            ->and(Media::query()->where('owner_id', $this->owner->id)->count())->toBe(3)
            ->and(bhPublicFileCount($photos))->toBe(12);
    });

    it('does not touch the photos of a live vehicle or a live modification', function () {
        [, , $photos] = bhVehicleWithFiles($this->owner);

        Artisan::call('media:prune');

        expect(Media::query()->where('owner_id', $this->owner->id)->count())->toBe(4)
            ->and(bhPublicFileCount($photos))->toBe(16);
    });

    /**
     * What an older build could leave: the row of the vehicle or the modification hard-deleted, its photos still live.
     */
    function bhHardDeleteRaw(string $table, string $id): void
    {
        Schema::disableForeignKeyConstraints();
        DB::table($table)->where('id', $id)->delete();
        Schema::enableForeignKeyConstraints();
    }

    it('takes back live photos whose vehicle row is gone altogether (BH-49 residual)', function () {
        [$vehicle, $mod, $photos] = bhVehicleWithFiles($this->owner);
        $avatar = Media::factory()->forModel($this->owner)->create(['owner_id' => $this->owner->id]);
        bhHardDeleteRaw('modifications', $mod->id);
        bhHardDeleteRaw('vehicles', $vehicle->id);

        Artisan::call('media:prune');

        expect(Media::query()->where('owner_id', $this->owner->id)->pluck('id')->all())->toBe([$avatar->id])
            ->and(bhPublicFileCount($photos))->toBe(0)
            ->and(Media::withTrashed()->where('owner_id', $this->owner->id)->count())->toBe(5);
    });

    it('takes back a live photo whose modification row is gone, and leaves the live gallery alone', function () {
        [$vehicle, $mod, $photos] = bhVehicleWithFiles($this->owner);
        $photo = $mod->media()->firstOrFail();
        $stamp = DB::table('vehicles')->where('id', $vehicle->id)->value('updated_at');
        $this->travel(1)->hours();
        bhHardDeleteRaw('modifications', $mod->id);

        Artisan::call('media:prune');

        expect(Media::query()->whereKey($photo->id)->exists())->toBeFalse()
            ->and(Media::query()->where('owner_id', $this->owner->id)->count())->toBe(3)
            ->and(bhPublicFileCount($photos))->toBe(12)
            ->and(DB::table('vehicles')->where('id', $vehicle->id)->value('updated_at'))->toBe($stamp);
    });

    it('leaves an unattached upload to its own age rule', function () {
        $loose = Media::factory()->create(['owner_id' => $this->owner->id, 'mediable_type' => null, 'mediable_id' => null]);

        Artisan::call('media:prune');

        expect(Media::query()->whereKey($loose->id)->exists())->toBeTrue();
    });

    describe('when one item keeps throwing', function () {
        /**
         * The fault of one row: its delete throws on every run, whatever calls it.
         */
        function bhDeleteThatThrowsOn(string $id): void
        {
            app()->bind(DeleteMedia::class, fn ($app) => new class($app->make(MediaService::class), $app->make(VehicleSearchProjector::class), $app->make(OgImages::class), $id) extends DeleteMedia
            {
                public function __construct(MediaService $service, VehicleSearchProjector $search, OgImages $og, private readonly string $broken)
                {
                    parent::__construct($service, $search, $og);
                }

                public function handle(Media $media): void
                {
                    if ($media->getKey() === $this->broken) {
                        throw new RuntimeException('This row keeps failing.');
                    }

                    parent::handle($media);
                }
            });
        }

        beforeEach(function () {
            Exceptions::fake();
            $bystander = User::factory()->create();
            $this->oldFailed = bhFailedPhoto(publishedVehicle($bystander));
            $this->orphan = Media::factory()->create(['owner_id' => $bystander->id, 'mediable_type' => null, 'mediable_id' => null]);
            $this->travel(31)->days();
            Media::query()->whereKey($this->orphan->id)->toBase()->update(['created_at' => now()->subDays(2)]);
        });

        it('goes on with the next vehicle and with every later step, and reports the fault', function () {
            [$one, , $onePhotos] = bhVehicleWithFiles($this->owner);
            [$two, , $twoPhotos] = bhVehicleWithFiles(User::factory()->create());
            $one->delete();
            $two->delete();
            // The sweep has no order of its own: the broken one is the one it reaches first.
            [$broken, $next, $nextPhotos] = $one->id < $two->id ? [$one, $two, $twoPhotos] : [$two, $one, $onePhotos];
            bhDeleteThatThrowsOn($broken->media()->orderBy('id')->firstOrFail()->id);

            expect(Artisan::call('media:prune'))->toBe(0);

            Exceptions::assertReported(fn (RuntimeException $exception): bool => $exception->getMessage() === 'This row keeps failing.');
            expect(bhPublicFileCount($nextPhotos))->toBe(0)
                ->and(Media::query()->where('owner_id', $next->owner_id)->count())->toBe(0)
                ->and(Media::withTrashed()->whereKey($this->orphan->id)->exists())->toBeFalse()
                ->and(Media::withTrashed()->whereKey($this->oldFailed->id)->exists())->toBeFalse();
        });

        it('goes on with the later steps when one row cannot be removed', function () {
            $stuck = Media::factory()->forModel(publishedVehicle(User::factory()->create()))->create(['status' => MediaStatus::Processing]);
            Media::query()->whereKey($stuck->id)->toBase()->update(['created_at' => now()->subDays(2)]);
            $broken = $this->orphan->id;

            app()->bind(MediaService::class, fn ($app) => new class($app->make(ImageProcessor::class), $broken) extends MediaService
            {
                public function __construct(ImageProcessor $processor, private readonly string $broken)
                {
                    parent::__construct($processor);
                }

                public function purge(Media $media): void
                {
                    if ($media->getKey() === $this->broken) {
                        throw new RuntimeException('This row keeps failing.');
                    }

                    parent::purge($media);
                }
            });

            expect(Artisan::call('media:prune'))->toBe(0);

            Exceptions::assertReported(fn (RuntimeException $exception): bool => $exception->getMessage() === 'This row keeps failing.');
            expect(Media::withTrashed()->whereKey($broken)->exists())->toBeTrue()
                ->and($stuck->fresh()->status)->toBe(MediaStatus::Failed)
                ->and(Media::withTrashed()->whereKey($this->oldFailed->id)->exists())->toBeFalse();
        });

        it('goes on with the next photo of a deleted modification', function () {
            [, $mod] = bhVehicleWithFiles($this->owner);
            Media::factory()->forModel($mod)->create(['owner_id' => $this->owner->id]);
            [$broken, $next] = $mod->media()->orderBy('id')->get()->all();
            bhDeleteThatThrowsOn($broken->id);
            $mod->delete();

            expect(Artisan::call('media:prune'))->toBe(0);

            Exceptions::assertReported(RuntimeException::class);
            expect(Media::query()->whereKey($next->id)->exists())->toBeFalse()
                ->and(Media::query()->whereKey($broken->id)->exists())->toBeTrue()
                ->and(Media::withTrashed()->whereKey($this->orphan->id)->exists())->toBeFalse();
        });

        /**
         * Two vehicles past the grace period, the one the command reaches first in front. Its query has no order of its own either.
         *
         * @return array{0: Vehicle, 1: Vehicle}
         */
        function bhExpiredVehicles(User $owner): array
        {
            [$one] = bhVehicleWithFiles($owner);
            [$two] = bhVehicleWithFiles(User::factory()->create());
            $one->delete();
            $two->delete();
            test()->travel(31)->days();

            [$first, $second] = Vehicle::onlyTrashed()->where('deleted_at', '<', now()->subDays(30))->limit(200)->get()->all();

            return [$first, $second];
        }

        it('vehicles:prune leaves a vehicle whose photos could not be taken back and goes on with the next', function () {
            [$broken, $next] = bhExpiredVehicles($this->owner);
            bhDeleteThatThrowsOn($broken->media()->orderBy('id')->firstOrFail()->id);

            expect(Artisan::call('vehicles:prune'))->toBe(0)
                ->and(Artisan::output())->toContain('Hard-deleted 1 vehicles.');

            Exceptions::assertReported(fn (RuntimeException $exception): bool => $exception->getMessage() === 'This row keeps failing.');
            expect(Vehicle::onlyTrashed()->whereKey($broken->id)->exists())->toBeTrue()
                ->and(Vehicle::withTrashed()->whereKey($next->id)->exists())->toBeFalse();

            // Once the fault is gone, the next run finishes the job.
            app()->forgetInstance(DeleteMedia::class);
            app()->offsetUnset(DeleteMedia::class);

            expect(Artisan::call('vehicles:prune'))->toBe(0)
                ->and(Vehicle::withTrashed()->whereKey($broken->id)->exists())->toBeFalse();
        });

        it('vehicles:prune goes on with the next vehicle when a hard delete fails, and that vehicle stays whole', function () {
            [$broken, $next] = bhExpiredVehicles($this->owner);
            $code = QrCode::factory()->create(['vehicle_id' => $broken->id, 'status' => QrStatus::Active]);

            app()->bind(QrCodes::class, fn () => new class($broken->id) extends QrCodes
            {
                public function __construct(private readonly string $broken) {}

                public function revoke(Vehicle $vehicle, QrRevocationReason $reason): int
                {
                    $revoked = parent::revoke($vehicle, $reason);

                    if ($vehicle->getKey() === $this->broken) {
                        throw new RuntimeException('The hard delete failed.');
                    }

                    return $revoked;
                }
            });

            expect(Artisan::call('vehicles:prune'))->toBe(0)
                ->and(Artisan::output())->toContain('Hard-deleted 1 vehicles.');

            Exceptions::assertReported(fn (RuntimeException $exception): bool => $exception->getMessage() === 'The hard delete failed.');
            expect(Vehicle::onlyTrashed()->whereKey($broken->id)->exists())->toBeTrue()
                ->and($code->fresh()->status)->toBe(QrStatus::Active)
                ->and(Vehicle::withTrashed()->whereKey($next->id)->exists())->toBeFalse();
        });
    });

    describe('the sweep stays within its budget', function () {
        /**
         * @return array{0: Vehicle, 1: Vehicle, 2: string, 3: string}
         */
        function bhTwoSweptVehicles(): array
        {
            [$one] = bhVehicleWithFiles($ownerOne = User::factory()->create());
            [$two] = bhVehicleWithFiles($ownerTwo = User::factory()->create());
            $one->delete();
            $two->delete();

            return [$one, $two, $ownerOne->id, $ownerTwo->id];
        }

        function bhLivePhotos(string $owner): int
        {
            return Media::query()->where('owner_id', $owner)->count();
        }

        it('takes one vehicle at a batch of one, and the other in the next run', function () {
            [, , $one, $two] = bhTwoSweptVehicles();

            expect(app(SweepDetachedMedia::class)->handle(1))->toBe(4)
                ->and([bhLivePhotos($one), bhLivePhotos($two)])->toEqualCanonicalizing([0, 4]);

            expect(app(SweepDetachedMedia::class)->handle(1))->toBe(4)
                ->and([bhLivePhotos($one), bhLivePhotos($two)])->toBe([0, 0]);
        });

        it('counts attempts, not vehicles: a vehicle full of photos uses up the batch, and the rest waits', function () {
            [, , $one, $two] = bhTwoSweptVehicles();
            $live = publishedVehicle(User::factory()->create());
            $mod = modIn($live, 'exhaust');
            $modPhoto = Media::factory()->forModel($mod)->create(['owner_id' => $live->owner_id]);
            $mod->delete();

            // Room for both vehicles in the query, and four photos in the first of them.
            expect(app(SweepDetachedMedia::class)->handle(2))->toBe(4)
                ->and([bhLivePhotos($one), bhLivePhotos($two)])->toEqualCanonicalizing([0, 4])
                ->and(Media::query()->whereKey($modPhoto->id)->exists())->toBeTrue();
        });
    });

    it('withdraws them even if vehicles:prune comes first', function () {
        [$vehicle, , $photos] = bhVehicleWithFiles($this->owner);
        $vehicle->delete();
        $this->travel(31)->days();

        Artisan::call('vehicles:prune');

        expect(Vehicle::withTrashed()->find($vehicle->id))->toBeNull()
            ->and(bhPublicFileCount($photos))->toBe(0)
            ->and(Media::query()->where('owner_id', $this->owner->id)->count())->toBe(0);
    });
});
