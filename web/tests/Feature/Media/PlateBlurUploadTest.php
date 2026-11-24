<?php

use App\Enums\MediaStatus;
use App\Enums\PlateBlurState;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\PlateBlurChoice;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once dirname(__DIR__).'/Events/EventTestHelpers.php';
require_once dirname(__DIR__).'/Businesses/BusinessTestHelpers.php';
require_once dirname(__DIR__).'/Social2/Social2TestHelpers.php';
require_once dirname(__DIR__).'/Messaging/MessagingTestHelpers.php';
require_once dirname(__DIR__).'/Signature/SignatureTestHelpers.php';

/**
 * M5.9a upload fields `plate_blur` + `blur_regions` (m5.9a-contract §1–§3): one validation for every upload endpoint, the state each
 * choice stores, the owner-only `plate_blur` in API answers, and GAR-08 (PATCH media/{media}) for the new kinds, adding pixelation only.
 * The pixels themselves: PlateBlurLeakTest.
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    config(['speedclub.media.disk' => 'public', 'speedclub.media.private_disk' => 'local', 'speedclub.messaging.media_disk' => 'local']);
    evFlags();
    bizFlags();
    s2Flags();
    msgFlags();
    sigFlag('sig.plate_blur');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'pbu.halter', 'created_at' => now()->subDays(30)]);
    $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
});

const PBU_PLATE = ['x' => 0.32, 'y' => 0.7, 'w' => 0.36, 'h' => 0.12];

/**
 * @param  array<string, mixed>  $fields
 */
function pbuUpload(string $uri, array $fields = []): TestResponse
{
    return test()->post($uri, ['file' => UploadedFile::fake()->createWithContent('heck.jpg', TestImages::jpeg(800, 600)), ...$fields], ['Accept' => 'application/json']);
}

function pbuUri(string $endpoint, User $owner, Vehicle $vehicle): string
{
    return match ($endpoint) {
        'vehicle' => "/api/v1/vehicles/{$vehicle->id}/media",
        'modification' => '/api/v1/mods/'.Modification::factory()->create(['vehicle_id' => $vehicle->id])->id.'/media',
        'build update' => '/api/v1/build-updates/'.s2Post($vehicle)->id.'/media',
        'message' => '/api/v1/conversations/'.msgStart(ntfMember('pbu.partner'), $owner, 'Moin!')->conversation_id.'/media',
        'profile cover' => '/api/v1/me/cover',
        'avatar' => '/api/v1/me/avatar',
        'event cover' => '/api/v1/events/'.evEvent($owner)->slug.'/cover',
        'business cover' => (function () use ($owner): string {
            bizBusiness($owner);

            return '/api/v1/me/business/cover';
        })(),
        default => throw new InvalidArgumentException($endpoint),
    };
}

function pbuNewest(User $owner): Media
{
    return Media::query()->where('owner_id', $owner->id)->latest('id')->firstOrFail();
}

describe('validation', function () {
    it('refuses a bad plate choice with 422 on every upload endpoint, and stores nothing', function (string $endpoint, array $fields, string $field) {
        $uri = pbuUri($endpoint, $this->owner, $this->vehicle);
        Sanctum::actingAs($this->owner);
        $before = Media::query()->count();

        pbuUpload($uri, $fields)->assertUnprocessable()->assertJsonValidationErrors($field);

        expect(Media::query()->count())->toBe($before);
    })->with(['vehicle', 'modification', 'build update', 'message', 'profile cover', 'event cover', 'business cover'])->with([
        'blur on without regions' => [['plate_blur' => '1'], 'blur_regions'],
        'blur on with an empty list' => [['plate_blur' => '1', 'blur_regions' => '[]'], 'blur_regions'],
        'not JSON' => [['plate_blur' => '1', 'blur_regions' => 'Kennzeichen'], 'blur_regions'],
        'nine regions' => [['plate_blur' => '1', 'blur_regions' => json_encode(array_fill(0, 9, PBU_PLATE))], 'blur_regions'],
        'switch not a boolean' => [['plate_blur' => 'ja'], 'plate_blur'],
    ]);

    it('checks each rectangle', function (array $region, string $field) {
        Sanctum::actingAs($this->owner);

        pbuUpload("/api/v1/vehicles/{$this->vehicle->id}/media", ['plate_blur' => '1', 'blur_regions' => json_encode([$region])])
            ->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'missing side' => [['x' => 0.1, 'y' => 0.1, 'w' => 0.2], 'blur_regions.0'],
        'extra key' => [[...PBU_PLATE, 'r' => 2], 'blur_regions.0'],
        'x below 0' => [['x' => -0.01, 'y' => 0.1, 'w' => 0.2, 'h' => 0.1], 'blur_regions.0.x'],
        'y above 1' => [['x' => 0.1, 'y' => 1.01, 'w' => 0.2, 'h' => 0.1], 'blur_regions.0.y'],
        'w below 0.02' => [['x' => 0.1, 'y' => 0.1, 'w' => 0.019, 'h' => 0.1], 'blur_regions.0.w'],
        'h below 0.02' => [['x' => 0.1, 'y' => 0.1, 'w' => 0.2, 'h' => 0.01], 'blur_regions.0.h'],
        'w above 1' => [['x' => 0, 'y' => 0.1, 'w' => 1.2, 'h' => 0.1], 'blur_regions.0.w'],
        'past the right edge' => [['x' => 0.8, 'y' => 0.1, 'w' => 0.21, 'h' => 0.1], 'blur_regions.0'],
        'past the bottom edge' => [['x' => 0.1, 'y' => 0.95, 'w' => 0.2, 'h' => 0.06], 'blur_regions.0'],
        'text' => [['x' => 'links', 'y' => 0.1, 'w' => 0.2, 'h' => 0.1], 'blur_regions.0.x'],
        'angle past 45°' => [[...PBU_PLATE, 'angle' => 45.5], 'blur_regions.0.angle'],
        'angle past −45°' => [[...PBU_PLATE, 'angle' => -46], 'blur_regions.0.angle'],
        'angle as text' => [[...PBU_PLATE, 'angle' => 'schräg'], 'blur_regions.0.angle'],
    ]);

    it('takes the edges, the 4-decimal tolerance, 8 regions, a JSON string or an array', function (array $fields) {
        Sanctum::actingAs($this->owner);

        pbuUpload("/api/v1/vehicles/{$this->vehicle->id}/media", $fields)->assertCreated();

        expect(pbuNewest($this->owner)->plate_blur)->toBe(PlateBlurState::Blurred);
    })->with([
        'JSON string' => [['plate_blur' => '1', 'blur_regions' => json_encode([PBU_PLATE])]],
        'array' => [['plate_blur' => '1', 'blur_regions' => [PBU_PLATE]]],
        'true as the switch' => [['plate_blur' => true, 'blur_regions' => [PBU_PLATE]]],
        'whole photo' => [['plate_blur' => '1', 'blur_regions' => json_encode([['x' => 0, 'y' => 0, 'w' => 1, 'h' => 1]])]],
        'smallest side' => [['plate_blur' => '1', 'blur_regions' => json_encode([['x' => 0.98, 'y' => 0.98, 'w' => 0.02, 'h' => 0.02]])]],
        'a rounding hair over the edge' => [['plate_blur' => '1', 'blur_regions' => json_encode([['x' => 0.6401, 'y' => 0.8801, 'w' => 0.36, 'h' => 0.12]])]],
        'eight regions' => [['plate_blur' => '1', 'blur_regions' => json_encode(array_fill(0, 8, PBU_PLATE))]],
        'turned 45° clockwise' => [['plate_blur' => '1', 'blur_regions' => json_encode([[...PBU_PLATE, 'angle' => 45]])]],
        'turned 12.5° anticlockwise' => [['plate_blur' => '1', 'blur_regions' => json_encode([[...PBU_PLATE, 'angle' => -12.5]])]],
        'angle 0 next to one without' => [['plate_blur' => '1', 'blur_regions' => json_encode([[...PBU_PLATE, 'angle' => 0], PBU_PLATE])]],
    ]);

    it('says how far a rectangle turns in German and English', function () {
        Sanctum::actingAs($this->owner);
        $uri = "/api/v1/vehicles/{$this->vehicle->id}/media";
        $fields = ['plate_blur' => '1', 'blur_regions' => json_encode([[...PBU_PLATE, 'angle' => 60]])];

        $this->withHeader('Accept-Language', 'de');
        expect(pbuUpload($uri, $fields)->json('errors')['blur_regions.0.angle'][0] ?? null)->toBe('Ein Bereich lässt sich höchstens um 45° nach links oder rechts drehen.');
        $this->withHeader('Accept-Language', 'en');
        expect(pbuUpload($uri, $fields)->json('errors')['blur_regions.0.angle'][0] ?? null)->toBe('An area can be turned at most 45° to the left or right.');
    });

    it('stores the angle with the region and drops a 0', function () {
        expect(PlateBlurChoice::normalise([[...PBU_PLATE, 'angle' => '-12.54'], [...PBU_PLATE, 'angle' => 0], PBU_PLATE]))->toBe([
            [...PBU_PLATE, 'angle' => -12.5],
            PBU_PLATE,
            PBU_PLATE,
        ]);
    });

    it('says what is missing in German and English', function () {
        Sanctum::actingAs($this->owner);
        $uri = "/api/v1/vehicles/{$this->vehicle->id}/media";

        $this->withHeader('Accept-Language', 'de');
        pbuUpload($uri, ['plate_blur' => '1'])
            ->assertJsonPath('errors.blur_regions.0', 'Markiere mindestens einen Bereich oder schalte „Kennzeichen unkenntlich machen“ aus.');
        $this->withHeader('Accept-Language', 'en');
        pbuUpload($uri, ['plate_blur' => '1', 'blur_regions' => json_encode(array_fill(0, 9, PBU_PLATE))])
            ->assertJsonPath('errors.blur_regions.0', 'You can blur at most 8 areas per photo.');
    });
});

describe('state', function () {
    it('stores blurred, declined or unchecked, and ignores regions without the switch', function (array $fields, PlateBlurState $state, bool $pixelated) {
        Sanctum::actingAs($this->owner);

        pbuUpload("/api/v1/vehicles/{$this->vehicle->id}/media", $fields)->assertCreated()
            ->assertJsonPath('data.plate_blur.state', $state->value);

        $media = pbuNewest($this->owner);
        expect($media->plate_blur)->toBe($state)
            ->and($media->blur_regions)->toBeNull()
            ->and($media->blurred_at !== null)->toBe($pixelated)
            ->and($media->status)->toBe(MediaStatus::Ready);
    })->with([
        'switch on' => [['plate_blur' => '1', 'blur_regions' => json_encode([PBU_PLATE])], PlateBlurState::Blurred, true],
        'switch off, regions ignored' => [['plate_blur' => '0', 'blur_regions' => 'kein JSON'], PlateBlurState::Declined, false],
        'not sent (older build), regions ignored' => [['blur_regions' => json_encode([PBU_PLATE])], PlateBlurState::Unchecked, false],
    ]);

    it('stores the choice for every endpoint', function (string $endpoint) {
        $uri = pbuUri($endpoint, $this->owner, $this->vehicle);
        Sanctum::actingAs($this->owner);

        pbuUpload($uri, ['plate_blur' => '1', 'blur_regions' => json_encode([PBU_PLATE])])->assertSuccessful();

        expect(pbuNewest($this->owner)->plate_blur)->toBe(PlateBlurState::Blurred);
    })->with(['vehicle', 'modification', 'build update', 'message', 'profile cover', 'avatar', 'event cover', 'business cover']);
});

describe('owner only', function () {
    beforeEach(function () {
        Sanctum::actingAs($this->owner);
        pbuUpload("/api/v1/vehicles/{$this->vehicle->id}/media", ['plate_blur' => '0'])->assertCreated();
        $this->media = pbuNewest($this->owner);
    });

    it('shows the state on the owner\'s garage answers', function () {
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()
            ->assertJsonPath('data.photos.0.id', $this->media->id)
            ->assertJsonPath('data.photos.0.plate_blur.state', 'declined');
        $this->patchJson("/api/v1/media/{$this->media->id}", ['alt' => 'Heck'])->assertOk()
            ->assertJsonPath('data.plate_blur.state', 'declined');
    });

    it('never shows it on a public answer or to anyone else', function (Closure $who) {
        $viewer = $who($this->owner);
        app('auth')->forgetGuards();

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $public = $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk();
        expect($public->json('data.photos.0.id'))->toBe($this->media->id)
            ->and(array_key_exists('plate_blur', $public->json('data.photos.0')))->toBeFalse()
            ->and($public->getContent())->not->toContain('plate_blur');

        if ($viewer !== null && $viewer->isNot($this->owner)) {
            $member = $this->getJson("/api/v1/vehicles/{$this->vehicle->id}");
            expect((string) $member->getContent())->not->toContain('plate_blur');
        }
    })->with([
        'guest' => [fn (User $owner): ?User => null],
        'other member' => [fn (User $owner): ?User => User::factory()->create()],
        'the owner on the public read' => [fn (User $owner): ?User => $owner],
    ]);
});

describe('GAR-08 later', function () {
    it('pixelates a build-update photo and the profile cover, and marks them blurred', function (string $endpoint) {
        Sanctum::actingAs($this->owner);
        pbuUpload(pbuUri($endpoint, $this->owner, $this->vehicle))->assertSuccessful();
        $media = pbuNewest($this->owner);
        expect($media->plate_blur)->toBe(PlateBlurState::Unchecked);

        $this->patchJson("/api/v1/media/{$media->id}", ['blur_regions' => [PBU_PLATE]])->assertOk();

        expect($media->refresh()->plate_blur)->toBe(PlateBlurState::Blurred)
            ->and($media->status)->toBe(MediaStatus::Ready)
            ->and($media->blurred_at)->not->toBeNull();
    })->with(['build update', 'profile cover']);

    it('takes a turned rectangle and refuses an angle past ±45°', function () {
        Sanctum::actingAs($this->owner);
        pbuUpload(pbuUri('build update', $this->owner, $this->vehicle))->assertSuccessful();
        $media = pbuNewest($this->owner);

        $this->patchJson("/api/v1/media/{$media->id}", ['blur_regions' => [[...PBU_PLATE, 'angle' => -50]]])->assertUnprocessable()
            ->assertJsonValidationErrors('blur_regions.0.angle');
        $this->patchJson("/api/v1/media/{$media->id}", ['blur_regions' => [[...PBU_PLATE, 'angle' => -30]]])->assertOk();

        expect($media->refresh()->plate_blur)->toBe(PlateBlurState::Blurred)->and($media->blurred_at)->not->toBeNull();
    });

    it('only ever adds pixelation: plate_blur false is refused', function () {
        Sanctum::actingAs($this->owner);
        pbuUpload("/api/v1/vehicles/{$this->vehicle->id}/media", ['plate_blur' => '1', 'blur_regions' => json_encode([PBU_PLATE])])->assertCreated();
        $media = pbuNewest($this->owner);

        $this->withHeader('Accept-Language', 'de')->patchJson("/api/v1/media/{$media->id}", ['plate_blur' => false])->assertUnprocessable()
            ->assertJsonPath('errors.plate_blur.0', 'Zum Ändern lädst du das Foto neu hoch.');
        $this->withHeader('Accept-Language', 'en')->patchJson("/api/v1/media/{$media->id}", ['plate_blur' => 0])->assertUnprocessable()
            ->assertJsonPath('errors.plate_blur.0', 'To change it, upload the photo again.');

        expect($media->refresh()->plate_blur)->toBe(PlateBlurState::Blurred);
    });

    it('still refuses an event or business cover', function (string $endpoint) {
        Sanctum::actingAs($this->owner);
        pbuUpload(pbuUri($endpoint, $this->owner, $this->vehicle))->assertSuccessful();

        $this->patchJson('/api/v1/media/'.pbuNewest($this->owner)->id, ['blur_regions' => [PBU_PLATE]])->assertUnprocessable()
            ->assertJsonValidationErrors('blur_regions');
    })->with(['event cover', 'business cover']);
});
