<?php

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ShareCardElement;
use App\Enums\UserStatus;
use App\Models\Block;
use App\Models\Media;
use App\Models\User;
use App\Models\VehicleSpec;
use App\Services\Media\MediaService;
use App\Services\Qr\QrCodes;
use App\Services\Signature\ShareCardCanvas;
use App\Services\Signature\ShareCardOptions;
use App\Services\Signature\ShareCards;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SignatureTestHelpers.php';

/**
 * CF-6 (client round 1, VEH-07) GET vehicles/{id}/share-card.png: the square card keeps the car visible (photo above, a band below with
 * the text, the gauge and the QR panel), and the member chooses the photo, what the card shows and the square band's theme. Only the
 * default card is stored publicly; a customised one is cached privately (at most ShareCards::CUSTOM_LIMIT per build, for a day).
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    sigFlag('sig.share_cards');
    [$this->vehicle, $this->cover] = sigVehicleWithPhoto(bytes: sigDetailedJpeg(1200, 800));
    $this->owner = $this->vehicle->owner;
    VehicleSpec::factory()->create(['vehicle_id' => $this->vehicle->id, 'power_value' => 510, 'power_unit' => 'ps', 'power_ps' => 510, 'torque_nm' => 650]);
    DB::table('build_scores')->updateOrInsert(['vehicle_id' => $this->vehicle->id], ['total' => 420, 'stage' => 3, 'formula_version' => '1', 'computed_at' => now()]);
    $this->vehicle->forceFill(['dex_number' => 87])->save();
    $this->second = app(MediaService::class)->storeFromUpload(UploadedFile::fake()->createWithContent('zwei.jpg', sigDetailedJpeg(1000, 1000)), $this->owner, $this->vehicle)->refresh();
    $this->url = "/api/v1/vehicles/{$this->vehicle->id}/share-card.png";
});

/** The PNG cropped to a rectangle, as PNG bytes. */
function sigCrop(string $png, int $x, int $y, int $width, int $height): string
{
    $image = imagecreatefromstring($png);
    $crop = $image === false ? false : imagecrop($image, ['x' => $x, 'y' => $y, 'width' => $width, 'height' => $height]);
    ob_start();
    imagepng($crop ?: imagecreatetruecolor(1, 1));

    return (string) ob_get_clean();
}

function sigMediaId(Media $media): string
{
    $media->save();

    return (string) $media->id;
}

/** Sets a cached card's file time, minutes ago (the fake disk is a real directory). */
function sigAge(string $path, int $minutes): void
{
    touch(Storage::disk('local')->path($path), time() - $minutes * 60);
    clearstatcache();
}

function sigCards(): ShareCards
{
    return app(ShareCards::class);
}

describe('square layout', function () {
    it('puts the QR panel in the band under the photo, and the code reads as the page address', function () {
        $png = (string) $this->get($this->url.'?format=square')->assertOk()->getContent();
        [$x, $y, $width, $height] = ShareCardCanvas::squareQrPanel();

        expect($y)->toBeGreaterThanOrEqual(ShareCardCanvas::SQUARE_PHOTO_HEIGHT)
            ->and($y + $height)->toBeLessThanOrEqual(1080)
            ->and($x + $width)->toBeLessThanOrEqual(1080)
            ->and(readQrText(sigCrop($png, $x - 8, $y - 8, $width + 16, $width + 16)))->toBe(app(QrCodes::class)->pageUrl($this->vehicle));
    });

    it('draws nothing on the photo but the gauge on its lower right corner (R5-2e rule 6)', function () {
        $full = (string) $this->get($this->url.'?format=square')->assertOk()->getContent();
        $score = (string) $this->get($this->url.'?format=square&show=score')->assertOk()->getContent();
        $bare = (string) $this->get($this->url.'?format=square&show=')->assertOk()->getContent();
        $gauge = app(ShareCardCanvas::class)->layout('square', 'band', ['title' => 'X', 'score' => true, 'score_labels' => ['Stufe 3', 'Build Score']])['boxes']['gauge'];

        expect(sigDifference($full, $score, 0, 0, 1080, ShareCardCanvas::SQUARE_PHOTO_HEIGHT))->toBe(0.0)
            ->and(sigDifference($score, $bare, 0, 0, $gauge[0], ShareCardCanvas::SQUARE_PHOTO_HEIGHT))->toBe(0.0)
            ->and(sigDifference($score, $bare, 0, 0, 1080, $gauge[1]))->toBe(0.0)
            ->and(sigDifference($score, $bare, $gauge[0], $gauge[1], $gauge[2] - $gauge[0], $gauge[3] - $gauge[1]))->toBeGreaterThan(1.0)
            ->and(sigDifference($full, $bare, 0, ShareCardCanvas::SQUARE_PHOTO_HEIGHT + 1, 1080, 1080 - ShareCardCanvas::SQUARE_PHOTO_HEIGHT - 1))->toBeGreaterThan(1.0);
    });

    it('leaves the code out when qr is not shown', function () {
        $png = (string) $this->get($this->url.'?format=square&show[]=score&show[]=specs')->assertOk()->getContent();

        expect(fn () => readQrText($png))->toThrow(Exception::class);

        $story = (string) $this->get($this->url.'?show=specs,username')->assertOk()->getContent();
        expect(fn () => readQrText($story))->toThrow(Exception::class);
    });

    it('draws the light band on request and keeps the story card as it is', function () {
        $dark = (string) $this->get($this->url.'?format=square')->getContent();
        $light = (string) $this->get($this->url.'?format=square&theme=light')->getContent();
        $band = imagecolorat(imagecreatefromstring($light), 20, 1060);

        expect(($band >> 16) & 255)->toBeGreaterThan(200)
            ->and(sigDifference($dark, $light, 0, ShareCardCanvas::SQUARE_PHOTO_HEIGHT + 1, 400, 300))->toBeGreaterThan(50.0)
            ->and(sigCards()->path($this->vehicle->fresh(ShareCards::RELATIONS), 'story', new ShareCardOptions(theme: 'light')))
            ->toBe(sigCards()->path($this->vehicle->fresh(ShareCards::RELATIONS), 'story'));
    });
});

describe('options', function () {
    it('draws another of the build\'s public photos', function () {
        $cover = (string) $this->get($this->url.'?format=square&show=')->getContent();
        $other = (string) $this->get($this->url.'?format=square&show=&photo='.$this->second->id)->assertOk()->getContent();

        expect(sigDifference($cover, $other, 0, 0, 1080, ShareCardCanvas::SQUARE_PHOTO_HEIGHT))->toBeGreaterThan(1.0);
    });

    it('answers 422 on photo for a photo that is not one of the build\'s public ones, the same for each', function (Closure $photo) {
        $id = $photo($this);

        $this->getJson($this->url.'?photo='.$id)->assertUnprocessable()->assertJsonValidationErrors('photo')
            ->assertJsonPath('errors.photo.0', __('signature.share_card.photo'));
    })->with([
        'another member\'s photo' => [fn ($test) => sigVehicleWithPhoto(User::factory()->create(['username' => 'anderer.fahrer']))[1]->id],
        'rejected' => [fn ($test) => sigMediaId($test->second->forceFill(['moderation_status' => ModerationStatus::Rejected]))],
        'still processing' => [fn ($test) => sigMediaId($test->second->forceFill(['status' => MediaStatus::Processing, 'variants' => null]))],
        'deleted' => [function ($test): string {
            $test->second->delete();

            return (string) $test->second->id;
        }],
        'unknown' => [fn () => '01JZZZZZZZZZZZZZZZZZZZZZZZ'],
    ]);

    it('validates format, show and theme', function (string $query, string $field) {
        $this->getJson($this->url.'?'.$query)->assertUnprocessable()->assertJsonValidationErrors($field)->assertJsonPath('code', 'validation_failed');
    })->with([
        'format' => ['format=banner', 'format'],
        'unknown element' => ['show[]=speed', 'show.0'],
        'unknown element, comma list' => ['show=score,laptime', 'show.1'],
        'element twice' => ['show[]=qr&show[]=qr', 'show.0'],
        'theme' => ['theme=neon', 'theme'],
        'photo too long' => ['photo='.str_repeat('a', 65), 'photo'],
    ]);

    it('keeps the element list in step with its enum', function () {
        expect(ShareCardOptions::ELEMENTS)->toBe(array_column(ShareCardElement::cases(), 'value'));
    });

    it('names a card after its options: each changes the hash, the defaults give the stored card', function () {
        $vehicle = $this->vehicle->fresh(ShareCards::RELATIONS);
        $default = sigCards()->path($vehicle, 'square');
        $paths = [
            sigCards()->path($vehicle, 'square', new ShareCardOptions(show: ['score', 'dex', 'specs', 'username'])),
            sigCards()->path($vehicle, 'square', new ShareCardOptions(show: ['dex', 'specs', 'username', 'qr'])),
            sigCards()->path($vehicle, 'square', new ShareCardOptions(theme: 'light')),
            sigCards()->path($vehicle, 'square', new ShareCardOptions(photo: (string) $this->second->id)),
        ];

        expect(array_unique([$default, ...$paths]))->toHaveCount(5)
            ->and(sigCards()->path($vehicle, 'square', new ShareCardOptions(photo: (string) $this->cover->id)))->toBe($default)
            ->and(sigCards()->path($vehicle, 'square', new ShareCardOptions(show: ['qr', 'username', 'specs', 'dex', 'score'])))->toBe($default);
    });
});

describe('storage', function () {
    it('stores the default card publicly and caches a customised one privately, never with a public URL', function () {
        $this->get($this->url.'?format=square')->assertOk();
        $this->get($this->url.'?format=square&theme=light&show=specs')->assertOk();

        $public = Storage::disk('public')->allFiles('share/'.strtolower($this->vehicle->id));
        $private = Storage::disk('local')->allFiles('share-cards/'.strtolower($this->vehicle->id));

        expect($public)->toHaveCount(1)->and($public[0])->toEndWith('-square.png')
            ->and($private)->toHaveCount(1)
            ->and(basename($private[0]))->toBe(basename((string) sigCards()->path($this->vehicle->fresh(ShareCards::RELATIONS), 'square', new ShareCardOptions(show: ['specs'], theme: 'light'))))
            ->and(Storage::disk('public')->allFiles('share-cards'))->toBe([]);

        // A second request reads the cache.
        Storage::disk('local')->put($private[0], 'cached');
        expect($this->get($this->url.'?format=square&theme=light&show=specs')->getContent())->toBe('cached');
    });

    it('keeps at most CUSTOM_LIMIT customised cards per build, the newest', function () {
        $combinations = [['score'], ['dex'], ['specs'], ['username'], ['qr'], ['score', 'dex'], ['specs', 'qr']];

        $directory = 'share-cards/'.strtolower($this->vehicle->id);

        foreach ($combinations as $index => $show) {
            // Each earlier card a minute older than the next; the new one is written now.
            foreach (Storage::disk('local')->allFiles($directory) as $file) {
                sigAge($file, 1 + (int) round((time() - Storage::disk('local')->lastModified($file)) / 60));
            }

            $this->get($this->url.'?format=square&show='.implode(',', $show))->assertOk();
        }

        $files = Storage::disk('local')->allFiles('share-cards/'.strtolower($this->vehicle->id));
        $first = basename((string) sigCards()->path($this->vehicle->fresh(ShareCards::RELATIONS), 'square', new ShareCardOptions(show: ['score'])));

        expect($files)->toHaveCount(ShareCards::CUSTOM_LIMIT)
            ->and(array_map(basename(...), $files))->not->toContain($first);
    });

    it('drops cached cards after a day in the daily sweep, and all of them when the build goes private', function () {
        $this->get($this->url.'?show=specs')->assertOk();
        sigAge(Storage::disk('local')->allFiles('share-cards')[0], (ShareCards::CUSTOM_TTL_HOURS + 1) * 60);
        $this->get($this->url.'?show=dex')->assertOk();

        $this->artisan('og:prune')->assertSuccessful();
        expect(Storage::disk('local')->allFiles('share-cards/'.strtolower($this->vehicle->id)))->toHaveCount(1);

        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/visibility", ['visibility' => 'private'])->assertOk();
        expect(Storage::disk('local')->allFiles('share-cards'))->toBe([]);

        // The owner still gets a customised card of the private build, drawn per request and never kept.
        $response = $this->get($this->url.'?show=specs&format=square')->assertOk();
        expect($response->headers->get('Cache-Control'))->toContain('no-store')
            ->and(Storage::disk('local')->allFiles('share-cards'))->toBe([])
            ->and(Storage::disk('public')->allFiles('share'))->toBe([]);
    });
});

describe('access', function () {
    it('gives a customised card to whoever may see the build', function (Closure $viewer, int $status) {
        $user = $viewer($this);

        if ($user instanceof User) {
            Sanctum::actingAs($user);
        }

        $response = $this->get($this->url.'?format=square&theme=light&photo='.$this->second->id);
        $response->assertStatus($status);

        if ($status === 404) {
            $response->assertJsonPath('code', 'vehicle_unavailable');
        }
    })->with([
        'guest' => [fn () => null, 200],
        'owner' => [fn ($test) => $test->owner, 200],
        'other member' => [fn () => User::factory()->create(), 200],
        'member the owner blocked' => [function ($test): User {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $test->owner->id, 'blocked_id' => $viewer->id]);

            return $viewer;
        }, 404],
    ]);

    it('answers 404 before looking at the photo for a build the viewer may not see', function (Closure $hide) {
        $viewer = $hide($this);

        if ($viewer instanceof User) {
            Sanctum::actingAs($viewer);
        }

        $this->getJson($this->url.'?photo='.$this->second->id)->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        $this->getJson($this->url.'?photo=01JZZZZZZZZZZZZZZZZZZZZZZZ')->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    })->with([
        'private build, guest' => [fn ($test) => $test->vehicle->forceFill(['visibility' => 'private'])->save() ? null : null],
        'private build, other member' => [fn ($test) => $test->vehicle->forceFill(['visibility' => 'private'])->save() ? User::factory()->create() : null],
        'owner suspended' => [fn ($test) => $test->owner->forceFill(['status' => UserStatus::Suspended, 'restrictions' => ['suspension' => ['until' => null]]])->save() ? null : null],
    ]);

    it('lets the owner of a private build customise the card', function () {
        $this->vehicle->forceFill(['visibility' => 'private'])->save();
        Sanctum::actingAs($this->owner);

        $png = (string) $this->get($this->url.'?format=square&photo='.$this->second->id)->assertOk()->getContent();

        expect(getimagesizefromstring($png)[1])->toBe(1080)
            ->and(Storage::disk('local')->allFiles('share-cards'))->toBe([]);
    });
});
