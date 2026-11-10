<?php

use App\Enums\MediaStatus;
use App\Enums\RestrictionType;
use App\Models\Block;
use App\Models\Media;
use App\Models\Staff;
use App\Models\User;
use App\Services\Media\BlurMedia;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SignatureTestHelpers.php';

/**
 * M2.7 [SIG sig.plate_blur] PATCH media/{id} {blur_regions} (m2.7-contract §1, 02_PRODUCT_SPEC §5, §9): the queue pixelates every variant and
 * the private original; the pre-blur original is discarded and nothing unblurred survives.
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    sigFlag('sig.plate_blur');
    [$this->vehicle, $this->media] = sigVehicleWithPhoto(bytes: sigDetailedJpeg(900, 600));
    $this->owner = $this->vehicle->owner;
});

/** The plate: a third of the width, a tenth of the height, in the lower middle. */
const SIG_PLATE = ['x' => 0.35, 'y' => 0.7, 'w' => 0.3, 'h' => 0.1];

/**
 * @return array{original: string, variants: array<string, string>}
 */
function sigFiles(Media $media): array
{
    /** @var array<string, string> $variants */
    $variants = $media->variants ?? [];

    return ['original' => (string) $media->original_path, 'variants' => $variants];
}

it('pixelates the region in the original and in every variant, and keeps nothing unblurred', function () {
    $before = sigFiles($this->media);
    $originalBefore = Storage::disk('local')->get($before['original']);
    $variantsBefore = array_map(fn (string $path): string => (string) Storage::disk('public')->get($path), $before['variants']);
    $blurhashBefore = $this->media->blurhash;
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE]])->assertOk()
        ->assertJsonPath('data.id', $this->media->id);

    $media = $this->media->refresh();
    $after = sigFiles($media);
    $originalAfter = Storage::disk('local')->get($after['original']);

    expect($media->status)->toBe(MediaStatus::Ready)
        ->and($media->blur_regions)->toBeNull()
        ->and($media->blurred_at)->not->toBeNull()
        ->and($media->blurhash)->not->toBe($blurhashBefore)
        // New names everywhere: old URLs stop working (ADR-123).
        ->and($after['original'])->not->toBe($before['original'])
        ->and(array_keys($after['variants']))->toBe(array_keys($before['variants']))
        ->and(array_values(array_intersect($after['variants'], $before['variants'])))->toBe([]);

    // Nothing of the photo is left on either disk but its new files: the pre-blur original and the old variants are gone.
    $directory = 'media/'.strtolower($media->id);
    expect(Storage::disk('local')->allFiles($directory))->toBe([$after['original']])
        ->and(Storage::disk('public')->allFiles($directory))->toEqualCanonicalizing(array_values($after['variants']))
        ->and(Storage::disk('local')->exists($before['original']))->toBeFalse();

    foreach ($before['variants'] as $path) {
        expect(Storage::disk('public')->exists($path))->toBeFalse();
    }

    // The pixels: inside the plate the fine detail is gone and the image differs; outside it stays as it was (within JPEG noise).
    [$width, $height] = [900, 600];
    $plate = [(int) (0.35 * $width) + 4, (int) (0.7 * $height) + 4, (int) (0.3 * $width) - 8, (int) (0.1 * $height) - 8];
    $outside = [20, 20, 200, 150];

    expect(sigDetail($originalBefore, ...$plate))->toBeGreaterThan(15.0)
        ->and(sigDetail($originalAfter, ...$plate))->toBeLessThan(sigDetail($originalBefore, ...$plate) / 4)
        ->and(sigDifference($originalBefore, $originalAfter, ...$plate))->toBeGreaterThan(30.0)
        ->and(sigDifference($originalBefore, $originalAfter, ...$outside))->toBeLessThan(12.0);

    foreach ($after['variants'] as $variantWidth => $path) {
        $bytes = (string) Storage::disk('public')->get($path);
        $scale = (int) $variantWidth / $width;
        $scaled = array_map(fn (int $value): int => max(1, (int) floor($value * $scale)), $plate);

        expect(sigDetail($variantsBefore[$variantWidth], ...$scaled))->toBeGreaterThan(10.0)
            ->and(sigDetail($bytes, ...$scaled))->toBeLessThan(sigDetail($variantsBefore[$variantWidth], ...$scaled) / 3)
            ->and(sigDifference($variantsBefore[$variantWidth], $bytes, ...$scaled))->toBeGreaterThan(20.0);
    }
});

it('answers processing without variants while the queue works, and the old files are already gone', function () {
    Queue::fake();
    $before = sigFiles($this->media);
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE, ['x' => 0, 'y' => 0, 'w' => 0.1, 'h' => 0.1]]])->assertOk()
        ->assertJsonPath('data.status', 'processing')
        ->assertJsonPath('data.variants', []);

    Queue::assertPushed(BlurMedia::class, fn (BlurMedia $job): bool => $job->mediaId === $this->media->id);

    foreach ($before['variants'] as $path) {
        expect(Storage::disk('public')->exists($path))->toBeFalse();
    }

    // Others no longer see it at all while it is processing; a second request waits for the first.
    Sanctum::actingAs(User::factory()->create());
    expect($this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()->json('data.photos'))->toBe([])
        ->and($this->media->refresh()->blur_regions)->toHaveCount(2);
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE]])->assertUnprocessable()
        ->assertJsonValidationErrors('blur_regions');

    // The job runs: the photo is back, under new names.
    (new BlurMedia($this->media->id))->handle(app(MediaService::class));
    expect($this->media->refresh()->status)->toBe(MediaStatus::Ready)
        ->and(array_values(array_intersect($this->media->variants ?? [], $before['variants'])))->toBe([]);
});

it('purges the OG image at once and draws a new one from the pixelated photo', function () {
    $og = app(OgImages::class);
    $first = $og->draw($this->vehicle->fresh(OgImages::VEHICLE_RELATIONS));
    $path = $this->vehicle->refresh()->og_image_path;
    expect($path)->not->toBeNull()->and(Storage::disk('public')->exists($path))->toBeTrue();
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE]])->assertOk();

    $second = $og->draw($this->vehicle->fresh(OgImages::VEHICLE_RELATIONS));

    expect(Storage::disk('public')->exists($path))->toBeFalse()
        ->and($second)->not->toBe($first)
        ->and($this->vehicle->refresh()->og_image_path)->not->toBe($path);
});

it('fails the photo without leaving the unblurred original when the queue gives up', function () {
    Queue::fake();
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE]])->assertOk();

    (new BlurMedia($this->media->id))->failed(new RuntimeException('disk full'));

    $media = $this->media->refresh();
    expect($media->status)->toBe(MediaStatus::Failed)
        ->and(Storage::disk('local')->allFiles('media/'.strtolower($media->id)))->toBe([])
        ->and(Storage::disk('public')->allFiles('media/'.strtolower($media->id)))->toBe([]);
});

it('validates the regions', function (array $body, string $field) {
    Sanctum::actingAs($this->owner);

    $this->withHeader('Accept-Language', 'de')->patchJson("/api/v1/media/{$this->media->id}", $body)->assertUnprocessable()
        ->assertJsonValidationErrors($field);

    expect($this->media->refresh()->status)->toBe(MediaStatus::Ready);
})->with([
    'empty list' => [['blur_regions' => []], 'blur_regions'],
    'not a list' => [['blur_regions' => 'plate'], 'blur_regions'],
    'eleven regions' => [['blur_regions' => array_fill(0, 11, SIG_PLATE)], 'blur_regions'],
    'missing side' => [['blur_regions' => [['x' => 0.1, 'y' => 0.1, 'w' => 0.2]]], 'blur_regions.0'],
    'extra key' => [['blur_regions' => [[...SIG_PLATE, 'r' => 3]]], 'blur_regions.0'],
    'negative' => [['blur_regions' => [['x' => -0.1, 'y' => 0.1, 'w' => 0.2, 'h' => 0.1]]], 'blur_regions.0.x'],
    'zero width' => [['blur_regions' => [['x' => 0.1, 'y' => 0.1, 'w' => 0, 'h' => 0.1]]], 'blur_regions.0.w'],
    'beyond the edge' => [['blur_regions' => [['x' => 0.8, 'y' => 0.1, 'w' => 0.3, 'h' => 0.1]]], 'blur_regions.0'],
    'text' => [['blur_regions' => [['x' => 'links', 'y' => 0.1, 'w' => 0.2, 'h' => 0.1]]], 'blur_regions.0.x'],
]);

it('says how many regions are allowed, in both languages', function () {
    Sanctum::actingAs($this->owner);
    $body = ['blur_regions' => array_fill(0, 11, SIG_PLATE)];

    $this->withHeader('Accept-Language', 'de')->patchJson("/api/v1/media/{$this->media->id}", $body)
        ->assertJsonPath('errors.blur_regions.0', 'Du kannst höchstens 10 Bereiche pro Foto unkenntlich machen.');
    $this->withHeader('Accept-Language', 'en')->patchJson("/api/v1/media/{$this->media->id}", $body)
        ->assertJsonPath('errors.blur_regions.0', 'You can blur at most 10 areas per photo.');
});

it('refuses a photo that is not finished', function (MediaStatus $status) {
    $this->media->forceFill(['status' => $status])->save();
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE]])->assertUnprocessable()
        ->assertJsonValidationErrors('blur_regions');
})->with([MediaStatus::Processing, MediaStatus::Failed]);

it('does not exist while the flag is off, and the other fields keep working', function () {
    sigFlag('sig.plate_blur', false);
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE]])->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->patchJson("/api/v1/media/{$this->media->id}", ['alt' => 'Heck mit Kennzeichen'])->assertOk()->assertJsonPath('data.alt', 'Heck mit Kennzeichen');
});

describe('authorisation matrix', function () {
    it('lets only the owner blur', function (Closure $who, int $status) {
        $viewer = $who($this->owner);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $before = sigFiles($this->media->refresh());
        $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE]])->assertStatus($status);

        if ($status !== 200) {
            expect(sigFiles($this->media->refresh()))->toBe($before)->and($this->media->status)->toBe(MediaStatus::Ready);
        }
    })->with([
        'guest' => [fn (User $owner): ?User => null, 401],
        'owner' => [fn (User $owner): ?User => $owner, 200],
        'other member' => [fn (User $owner): ?User => User::factory()->create(), 403],
        'member the owner blocked' => [function (User $owner): User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return $member;
        }, 403],
        'owner restricted from publishing' => [function (User $owner): User {
            $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => now()->addWeek()->format(DATE_ATOM)]]])->save();

            return $owner->refresh();
        }, 403],
    ]);

    it('does not take a staff session', function () {
        $this->actingAs(Staff::factory()->create(), 'staff');

        $this->patchJson("/api/v1/media/{$this->media->id}", ['blur_regions' => [SIG_PLATE]])->assertUnauthorized();
    });
});
