<?php

use App\Actions\Garage\ChangeVehicleVisibility;
use App\Actions\Garage\DeleteVehicle;
use App\Actions\Garage\PublishVehicle;
use App\Actions\Garage\UpdateVehicle;
use App\Actions\Garage\UpdateVehicleSpecs;
use App\Actions\Media\DeleteMedia;
use App\Actions\Media\ReorderVehicleMedia;
use App\Actions\Media\UpdateMedia;
use App\Enums\Visibility;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\DrawMemberOgImage;
use App\Services\PublicPages\DrawVehicleOgImage;
use App\Services\PublicPages\OgImages;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\Support\TestImages;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

beforeEach(function () {
    Storage::fake('public');
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
    $this->vehicle = publishedVehicle($this->owner, ['make_text' => 'Nissan', 'model_text' => 'Skyline GT-R']);
    $this->photo = $this->vehicle->media()->firstOrFail();
    putVariants($this->photo);
});

/**
 * The files a real upload leaves behind: left half red, right half blue.
 */
function putVariants(Media $media): void
{
    foreach ($media->getAttribute('variants') as $path) {
        Storage::disk('public')->put($path, TestImages::webp(1600, 1067));
    }
}

function freshVehicle(Vehicle $vehicle): Vehicle
{
    return Vehicle::query()->findOrFail($vehicle->id);
}

function ogPath(Vehicle|User $subject): ?string
{
    return $subject::query()->whereKey($subject->getKey())->toBase()->value('og_image_path');
}

function ogFiles(): array
{
    return [...Storage::disk('public')->files('og/v'), ...Storage::disk('public')->files('og/u')];
}

/**
 * The address a page names for the file at $path: /og/v/{slug}-{hash}.jpg (OgImageController draws what is missing).
 */
function ogAddress(Vehicle|User $subject, string $path): string
{
    $key = $subject instanceof Vehicle ? 'v/'.Vehicle::query()->findOrFail($subject->id)->canonicalSlug() : 'u/'.$subject->username;

    return url('/og/'.$key.'-'.substr(basename($path, '.jpg'), 0, 16).'.jpg');
}

function ogDefault(): string
{
    return app(OgImages::class)->defaultUrl();
}

describe('drawing in the queue or on the first crawler request, never during a page view', function () {
    it('names the address of the current card and queues the draw while no file shows it yet', function () {
        Queue::fake();

        $html = $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();
        $address = app(OgImages::class)->forVehicle(freshVehicle($this->vehicle)->load(OgImages::VEHICLE_RELATIONS));

        expect($address)->toMatch('~/og/v/'.preg_quote($this->vehicle->canonicalSlug(), '~').'-[0-9a-f]{16}\.jpg$~')
            ->and($html)->toContain('<meta property="og:image" content="'.$address.'">')
            ->and(ogFiles())->toBe([])
            ->and(ogPath($this->vehicle))->toBeNull();

        Queue::assertPushed(DrawVehicleOgImage::class, fn (DrawVehicleOgImage $job): bool => $job->vehicleId === $this->vehicle->id);
    });

    it('names the file once the queue drew it, and the page does not draw anything itself', function () {
        Queue::fake();
        (new DrawVehicleOgImage($this->vehicle->id))->handle(app(OgImages::class));
        $path = ogPath($this->vehicle);
        $stamp = Storage::disk('public')->lastModified($path);

        $html = $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        expect($html)->toContain('<meta property="og:image" content="'.ogAddress($this->vehicle, $path).'">')
            ->and(Storage::disk('public')->lastModified($path))->toBe($stamp);

        Queue::assertNotPushed(DrawVehicleOgImage::class);
    });

    it('names the new state while the file shows an older one, and queues the new one', function () {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $old = ogAddress($this->vehicle, (string) ogPath($this->vehicle));
        Queue::fake();
        $this->vehicle->forceFill(['model_id' => null, 'generation_id' => null, 'model_text' => 'Silvia'])->save();

        $html = $this->get('/v/'.freshVehicle($this->vehicle)->canonicalSlug())->assertOk()->getContent();

        expect($html)->not->toContain('content="'.$old.'"')
            ->and($html)->toContain('content="'.app(OgImages::class)->forVehicle(freshVehicle($this->vehicle)->load(OgImages::VEHICLE_RELATIONS)).'"')
            ->and($html)->not->toContain('content="'.ogDefault().'"');
        Queue::assertPushed(DrawVehicleOgImage::class, 1);
    });

    it('queues one draw per subject, however many reads and changes come first', function () {
        Queue::fake();

        $this->get('/v/'.$this->vehicle->canonicalSlug());
        $this->get('/v/'.$this->vehicle->canonicalSlug());
        app(OgImages::class)->queue(freshVehicle($this->vehicle));
        $this->get('/u/lukas.sc');

        Queue::assertPushed(DrawVehicleOgImage::class, 1);
        Queue::assertPushed(DrawMemberOgImage::class, fn (DrawMemberOgImage $job): bool => $job->memberId === $this->owner->id);
    });

    it('is queued by the changes the picture shows, after their commit', function (Closure $change) {
        Queue::fake();

        $change($this->vehicle, $this->photo, $this->owner);

        Queue::assertPushed(DrawVehicleOgImage::class, fn (DrawVehicleOgImage $job): bool => $job->vehicleId === $this->vehicle->id);
    })->with([
        'publish' => [function (Vehicle $vehicle, Media $photo, User $owner) {
            $vehicle->forceFill(['status' => 'draft', 'published_at' => null, 'is_main' => false])->save();
            app(PublishVehicle::class)->handle($owner, freshVehicle($vehicle));
        }],
        'edit' => [fn (Vehicle $vehicle, Media $photo, User $owner) => app(UpdateVehicle::class)->handle($owner, freshVehicle($vehicle), ['nickname' => 'Godzilla'])],
        'specs' => [fn (Vehicle $vehicle) => app(UpdateVehicleSpecs::class)->handle(freshVehicle($vehicle), ['power_value' => 280, 'power_unit' => 'ps', 'power_source' => 'factory'])],
        'focal point' => [fn (Vehicle $vehicle, Media $photo) => app(UpdateMedia::class)->handle($photo, ['focal_x' => 0.3, 'focal_y' => 0.6])],
        'photo order' => [function (Vehicle $vehicle) {
            $second = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id]);
            app(ReorderVehicleMedia::class)->handle(freshVehicle($vehicle), [$second->id, ...$vehicle->media()->whereKeyNot($second->id)->pluck('id')->all()]);
        }],
        'back from private' => [function (Vehicle $vehicle) {
            $vehicle->forceFill(['visibility' => 'private'])->save();
            app(ChangeVehicleVisibility::class)->handle(freshVehicle($vehicle), Visibility::Public);
        }],
    ]);

    it('is not queued for anything that may have no file', function (Closure $arrange) {
        $vehicle = $arrange($this->vehicle);
        Queue::fake();

        app(OgImages::class)->queue($vehicle);
        app(UpdateVehicle::class)->handle($this->owner, $vehicle, ['nickname' => 'x']);

        Queue::assertNotPushed(DrawVehicleOgImage::class);
    })->with([
        'draft' => [fn (Vehicle $vehicle) => Vehicle::factory()->create(['owner_id' => $vehicle->owner_id])],
        'private' => [function (Vehicle $vehicle) {
            $vehicle->forceFill(['visibility' => 'private'])->save();

            return freshVehicle($vehicle);
        }],
    ]);

    it('does nothing for a subject that is gone by the time it runs', function () {
        (new DrawVehicleOgImage('01JAAAAAAAAAAAAAAAAAAAAAAA'))->handle(app(OgImages::class));
        (new DrawMemberOgImage('01JAAAAAAAAAAAAAAAAAAAAAAA'))->handle(app(OgImages::class));

        expect(ogFiles())->toBe([]);
    });
});

describe('vehicles', function () {
    it('draws a 1200 × 630 JPEG on the public disk and names it in the page', function () {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $html = $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        $path = ogPath($this->vehicle);

        expect($path)->toMatch('~^og/v/[0-9a-f]{40}\.jpg$~');
        Storage::disk('public')->assertExists($path);

        $bytes = Storage::disk('public')->get($path);
        [$width, $height, $type] = getimagesizefromstring($bytes);

        expect([$width, $height, $type])->toBe([1200, 630, IMAGETYPE_JPEG])
            ->and($html)->toContain('<meta property="og:image" content="'.ogAddress($this->vehicle, $path).'">')
            ->and(str_contains($path, $this->vehicle->id))->toBeFalse()
            ->and(str_contains($path, strtolower($this->vehicle->public_id)))->toBeFalse();
    });

    it('carries no metadata of the source', function () {
        $this->get('/v/'.$this->vehicle->canonicalSlug());

        $bytes = Storage::disk('public')->get(ogPath($this->vehicle));

        expect(str_contains($bytes, 'Exif'))->toBeFalse();
    });

    it('keeps the focal point in the crop', function () {
        // 1600 × 1067 crops to 1600 × 840, so only the height moves; with a tall photo the height decides what shows.
        foreach ($this->photo->getAttribute('variants') as $path) {
            $image = imagecreatetruecolor(800, 1600);
            imagefilledrectangle($image, 0, 0, 800, 800, (int) imagecolorallocate($image, 250, 0, 0));
            imagefilledrectangle($image, 0, 801, 800, 1600, (int) imagecolorallocate($image, 0, 0, 250));
            ob_start();
            imagewebp($image, null, 90);
            Storage::disk('public')->put($path, (string) ob_get_clean());
        }

        $this->photo->forceFill(['focal_x' => 0.5, 'focal_y' => 0.1])->save();
        $top = app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $topImage = imagecreatefromstring(Storage::disk('public')->get(ogPath($this->vehicle)));

        $this->photo->forceFill(['focal_x' => 0.5, 'focal_y' => 0.9])->save();
        $bottom = app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $bottomImage = imagecreatefromstring(Storage::disk('public')->get(ogPath($this->vehicle)));

        $colorAt = fn ($image): array => imagecolorsforindex($image, imagecolorat($image, 600, 200));

        expect($top)->not->toBe($bottom)
            ->and($colorAt($topImage)['red'])->toBeGreaterThan(150)
            ->and($colorAt($bottomImage)['blue'])->toBeGreaterThan(150);
    });

    it('does not draw again while nothing changed', function () {
        $service = app(OgImages::class);
        $first = $service->draw(freshVehicle($this->vehicle));
        $stamp = Storage::disk('public')->lastModified(ogPath($this->vehicle));
        $second = $service->draw(freshVehicle($this->vehicle));

        // The 1200 × 630 card and its square.
        expect($second)->toBe($first)
            ->and(Storage::disk('public')->lastModified(ogPath($this->vehicle)))->toBe($stamp)
            ->and(ogFiles())->toHaveCount(2);
    });

    it('draws again under a new name after a change, and the old file goes', function (Closure $change) {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $before = ogPath($this->vehicle);

        $change($this->vehicle, $this->photo);
        app(OgImages::class)->draw(freshVehicle($this->vehicle));

        $after = ogPath($this->vehicle);

        expect($after)->not->toBe($before);
        Storage::disk('public')->assertMissing($before);
        Storage::disk('public')->assertExists($after);
    })->with([
        'model name' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['model_id' => null, 'generation_id' => null, 'model_text' => 'Silvia'])->save()],
        'focal point' => [fn (Vehicle $vehicle, Media $photo) => $photo->forceFill(['focal_x' => 0.2])->save()],
        // The factory picks a random year, 1999 among them: always a year the vehicle does not have yet.
        'year in the specs' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['model_year' => $vehicle->model_year === 1999 ? 2004 : 1999])->save()],
    ]);

    it('does not move updated_at of the vehicle', function () {
        $this->travelTo(now()->addHour());
        $before = freshVehicle($this->vehicle)->updated_at;

        app(OgImages::class)->draw(freshVehicle($this->vehicle));

        expect(freshVehicle($this->vehicle)->updated_at->equalTo($before))->toBeTrue();
    });

    it('gives an unlisted vehicle a file, since its link gets shared', function () {
        $this->vehicle->forceFill(['visibility' => 'unlisted'])->save();

        app(OgImages::class)->draw(freshVehicle($this->vehicle));

        expect(ogPath($this->vehicle))->not->toBeNull();
    });

    it('never gives anything hidden a file', function (Closure $hide) {
        $hide($this->vehicle);

        $url = app(OgImages::class)->forVehicle(Vehicle::withTrashed()->findOrFail($this->vehicle->id));
        $drawn = app(OgImages::class)->draw(Vehicle::withTrashed()->findOrFail($this->vehicle->id));

        expect($url)->toBe(ogDefault())
            ->and($drawn)->toBe(ogDefault())
            ->and(ogFiles())->toBe([])
            ->and(ogPath($this->vehicle))->toBeNull();
    })->with([
        'private' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['visibility' => 'private'])->save()],
        'draft' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['status' => 'draft'])->save()],
        'suspended owner' => [fn (Vehicle $vehicle) => $vehicle->owner->forceFill(['status' => 'suspended'])->save()],
    ]);

    it('uses the default without a usable photo', function () {
        $this->photo->forceFill(['moderation_status' => 'rejected'])->save();

        $html = $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        expect($html)->toContain('content="'.ogDefault().'"')
            ->and(ogFiles())->toBe([]);
    });

    it('falls back to the default and reports when drawing fails, and the page still answers', function () {
        Exceptions::fake();
        Storage::disk('public')->put($this->photo->getAttribute('variants')['1600'], 'kein Bild');

        expect(app(OgImages::class)->draw(freshVehicle($this->vehicle)))->toBe(ogDefault())
            ->and(ogFiles())->toBe([]);
        // GD cannot read the photo: the canvas says so instead of drawing garbage.
        Exceptions::assertReported(fn (RuntimeException $exception): bool => str_contains($exception->getMessage(), 'could not read'));

        $html = $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();
        preg_match('~<meta property="og:image" content="([^"]+)"~', $html, $match);

        // The page cannot know; its card address answers the delivered default card, briefly cached, never a broken image.
        $card = $this->get($match[1])->assertOk()->assertHeader('Content-Type', 'image/jpeg');

        expect($card->getContent())->toBe(file_get_contents(public_path('brand/og-default.jpg')))
            ->and($card->headers->get('Cache-Control'))->not->toContain('immutable');
    });

    it('removes the file when the vehicle goes private', function () {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $path = ogPath($this->vehicle);

        app(ChangeVehicleVisibility::class)->handle(freshVehicle($this->vehicle), Visibility::Private);

        Storage::disk('public')->assertMissing($path);
        expect(ogPath($this->vehicle))->toBeNull();
    });

    it('removes the file when the vehicle is deleted', function () {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $path = ogPath($this->vehicle);

        app(DeleteVehicle::class)->handle($this->owner, freshVehicle($this->vehicle));

        Storage::disk('public')->assertMissing($path);
        expect(ogFiles())->toBe([]);
    });

    it('removes the file with a deleted photo at once, which may be in it (ADR-123)', function () {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $path = ogPath($this->vehicle);

        app(DeleteMedia::class)->handle($this->photo);

        Storage::disk('public')->assertMissing($path);
    });
});

describe('members', function () {
    it('draws a card for a public member, with and without pictures', function (bool $withImages) {
        if ($withImages) {
            $avatar = Media::factory()->forModel($this->owner)->create(['owner_id' => $this->owner->id]);
            $cover = Media::factory()->forModel($this->owner)->create(['owner_id' => $this->owner->id]);
            putVariants($avatar);
            putVariants($cover);
            $this->owner->forceFill(['avatar_media_id' => $avatar->id, 'cover_media_id' => $cover->id])->save();
        }

        (new DrawMemberOgImage($this->owner->id))->handle(app(OgImages::class));
        $html = $this->get('/u/lukas.sc')->assertOk()->getContent();
        $path = ogPath($this->owner);

        expect($path)->toMatch('~^og/u/[0-9a-f]{40}\.jpg$~')
            ->and($html)->toContain('content="'.ogAddress($this->owner, $path).'"');

        expect(array_slice(getimagesizefromstring(Storage::disk('public')->get($path)), 0, 3))->toBe([1200, 630, IMAGETYPE_JPEG]);
    })->with(['with pictures' => true, 'plain' => false]);

    it('never gives a member who is not public a file', function () {
        $this->owner->forceFill(['status' => 'suspended'])->save();

        expect(app(OgImages::class)->forMember(User::query()->findOrFail($this->owner->id)))->toBe(ogDefault())
            ->and(ogFiles())->toBe([]);
    });

    it('removes the file with a deleted avatar', function () {
        $avatar = Media::factory()->forModel($this->owner)->create(['owner_id' => $this->owner->id]);
        putVariants($avatar);
        $this->owner->forceFill(['avatar_media_id' => $avatar->id])->save();
        $member = User::query()->findOrFail($this->owner->id);

        app(OgImages::class)->draw($member);
        $path = ogPath($member);

        app(DeleteMedia::class)->handle($avatar);

        Storage::disk('public')->assertMissing($path);
    });

    it('draws a new one after a rename', function () {
        $service = app(OgImages::class);
        $service->draw(User::query()->findOrFail($this->owner->id));
        $before = ogPath($this->owner);

        $this->owner->forceFill(['display_name' => 'Lukas Neu'])->save();
        $service->draw(User::query()->findOrFail($this->owner->id));

        expect(ogPath($this->owner))->not->toBe($before);
        Storage::disk('public')->assertMissing($before);
    });
});

describe('og:prune', function () {
    it('removes what became hidden elsewhere, such as through a suspension, and what changed', function () {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $path = ogPath($this->vehicle);

        $this->owner->forceFill(['status' => 'suspended'])->save();

        Artisan::call('og:prune');

        Storage::disk('public')->assertMissing($path);
        expect(ogPath($this->vehicle))->toBeNull();
    });

    it('removes a file that shows a photo staff rejected', function () {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $path = ogPath($this->vehicle);

        $this->photo->forceFill(['moderation_status' => 'rejected'])->save();
        Artisan::call('og:prune');

        Storage::disk('public')->assertMissing($path);
    });

    it('keeps what is current and removes old orphans, but not a file that was only just written', function () {
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $current = ogPath($this->vehicle);

        Storage::disk('public')->put('og/v/orphan.jpg', 'x');
        touch(Storage::disk('public')->path('og/v/orphan.jpg'), now()->subHours(2)->getTimestamp());
        Storage::disk('public')->put('og/v/in-flight.jpg', 'x');

        Artisan::call('og:prune');

        Storage::disk('public')->assertExists($current);
        Storage::disk('public')->assertExists('og/v/in-flight.jpg');
        Storage::disk('public')->assertMissing('og/v/orphan.jpg');
    });

    it('asks the database once per table for the files in use, however many files lie on the disk', function () {
        $old = fn (string $path) => touch(Storage::disk('public')->path($path), now()->subHours(2)->getTimestamp());
        app(OgImages::class)->draw(freshVehicle($this->vehicle));
        $current = (string) ogPath($this->vehicle);
        $old($current);

        $queriesWithOrphans = function (int $count) use ($old): int {
            foreach (range(1, $count) as $n) {
                foreach (['og/v', 'og/u'] as $directory) {
                    Storage::disk('public')->put($directory.'/orphan-'.$count.'-'.$n.'.jpg', 'x');
                    $old($directory.'/orphan-'.$count.'-'.$n.'.jpg');
                }
            }

            DB::flushQueryLog();
            DB::enableQueryLog();
            $removed = app(OgImages::class)->prune();
            DB::disableQueryLog();

            expect($removed)->toBe(2 * $count);

            return count(DB::getQueryLog());
        };

        expect($queriesWithOrphans(25))->toBe($queriesWithOrphans(2))
            ->and(collect(ogFiles())->sort()->values()->all())->toBe(collect([$current, substr($current, 0, -4).'-square.jpg'])->sort()->values()->all());
    });
});
