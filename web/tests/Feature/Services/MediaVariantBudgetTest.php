<?php

use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\ImageProcessor;
use App\Services\Media\MediaService;
use Illuminate\Support\Facades\Image;
use Illuminate\Support\Facades\Storage;
use Tests\Support\TestImages;

/**
 * M4.18: the byte budget of the WebP variants (speedclub.media.variant_budget_kb) and media:recompress for stored ones.
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    $this->owner = User::factory()->create();
    $this->vehicle = Vehicle::factory()->for($this->owner, 'owner')->create();
    $this->processor = app(ImageProcessor::class);
    $this->service = app(MediaService::class);
});

function budgetWebp(string $jpeg, int $width, int $quality): string
{
    return Image::fromBytes($jpeg)->scale(width: $width)->toWebp()->quality($quality)->toBytes();
}

/**
 * @return array{0: int, 1: int}
 */
function budgetSize(string $bytes): array
{
    $size = getimagesizefromstring($bytes);

    expect($size)->not->toBeFalse();

    return [$size[0], $size[1]];
}

function storeBudgetPhoto(MediaService $service, User $owner, Vehicle $vehicle, string $bytes): Media
{
    return $service->processOrQueue($service->reserve($owner, $vehicle, [], strlen($bytes)), $bytes)->refresh();
}

describe('the budget per width', function () {
    it('takes a configured width as it is and scales any other one from the next configured width', function () {
        config(['speedclub.media.variant_budget_kb' => [320 => 28, 640 => 80, 1080 => 176, 1600 => 316], 'speedclub.media.variant_budget_exponent' => 1.5]);

        expect($this->processor->budgetBytes(640))->toBe(80 * 1024)
            ->and($this->processor->budgetBytes(1600))->toBe(316 * 1024)
            ->and($this->processor->budgetBytes(1100))->toBe((int) round(316 * 1024 * (1100 / 1600) ** 1.5))
            ->and($this->processor->budgetBytes(500))->toBe((int) round(80 * 1024 * (500 / 640) ** 1.5))
            ->and($this->processor->budgetBytes(200))->toBe((int) round(28 * 1024 * (200 / 320) ** 1.5));
    });

    it('sets no limit when no budget is configured', function () {
        config(['speedclub.media.variant_budget_kb' => []]);

        expect($this->processor->budgetBytes(640))->toBe(PHP_INT_MAX);
    });

    it('ships 80 KB at 640 w and grows with the width', function () {
        expect($this->processor->budgetBytes(640))->toBe(80 * 1024)
            ->and($this->processor->budgetBytes(320))->toBeLessThan($this->processor->budgetBytes(640))
            ->and($this->processor->budgetBytes(1080))->toBeGreaterThan($this->processor->budgetBytes(640))
            ->and($this->processor->budgetBytes(1600))->toBeGreaterThan($this->processor->budgetBytes(1080));
    });
});

describe('an oversized photo', function () {
    it('steps the quality down to the floor and keeps the dimensions when the budget cannot be reached', function () {
        $image = $this->processor->process(TestImages::noisyJpeg());
        $floor = config()->integer('speedclub.media.variant_min_quality');

        // The fixture really is above the budget at the start quality.
        expect(strlen(budgetWebp($image->jpeg, 640, 80)))->toBeGreaterThan($this->processor->budgetBytes(640));

        expect($image->variants[640])->toBe(budgetWebp($image->jpeg, 640, $floor))
            ->and(strlen($image->variants[640]))->toBeLessThan(strlen(budgetWebp($image->jpeg, 640, 80)))
            ->and(budgetSize($image->variants[640]))->toBe(budgetSize(budgetWebp($image->jpeg, 640, 80)))
            ->and(budgetSize($image->variants[640])[0])->toBe(640)
            ->and(budgetSize($image->variants[1080])[0])->toBe(1080)
            ->and(budgetSize($image->variants[1100])[0])->toBe(1100);
    });

    it('stops at the first quality that fits', function () {
        $jpeg = $this->processor->process(TestImages::noisyJpeg())->jpeg;
        $atSeventyFive = strlen(budgetWebp($jpeg, 640, 75));
        $atEighty = strlen(budgetWebp($jpeg, 640, 80));
        expect($atSeventyFive)->toBeLessThan($atEighty);

        config(['speedclub.media.variant_budget_kb' => [640 => ($atSeventyFive + 1) / 1024]]);

        $variant = $this->processor->variant($jpeg, 640);

        expect($variant)->toBe(budgetWebp($jpeg, 640, 75))
            ->and(strlen($variant))->toBeLessThanOrEqual($this->processor->budgetBytes(640))
            ->and(budgetSize($variant)[0])->toBe(640);
    });

    it('never goes below the floor', function () {
        $jpeg = $this->processor->process(TestImages::noisyJpeg())->jpeg;
        config(['speedclub.media.variant_budget_kb' => [640 => 1], 'speedclub.media.variant_min_quality' => 70, 'speedclub.media.variant_quality_step' => 4]);

        // 80, 76, 72, then the floor 70 itself rather than 68.
        expect($this->processor->variant($jpeg, 640))->toBe(budgetWebp($jpeg, 640, 70));
    });

    it('keeps a photo within its budget at the start quality', function () {
        $image = $this->processor->process(TestImages::jpeg());

        foreach ($image->variants as $width => $webp) {
            expect($webp)->toBe(budgetWebp($image->jpeg, $width, 80))
                ->and(strlen($webp))->toBeLessThanOrEqual($this->processor->budgetBytes($width));
        }
    });
});

describe('media:recompress', function () {
    beforeEach(function () {
        $this->budgets = config('speedclub.media.variant_budget_kb');
        // Processed before the budget existed.
        config(['speedclub.media.variant_budget_kb' => []]);
        $this->noisy = storeBudgetPhoto($this->service, $this->owner, $this->vehicle, TestImages::noisyJpeg());
        $this->plain = storeBudgetPhoto($this->service, $this->owner, $this->vehicle, TestImages::jpeg());
        config(['speedclub.media.variant_budget_kb' => $this->budgets]);
        $this->before = $this->noisy->variants;
        $this->plainBefore = $this->plain->variants;
    });

    it('only counts on a dry run', function () {
        $this->artisan('media:recompress', ['--dry-run' => true])
            ->expectsOutputToContain('[dry run]')
            ->assertSuccessful();

        expect($this->noisy->refresh()->variants)->toBe($this->before);
    });

    it('encodes every variant above the budget again, removes the old files and is idempotent', function () {
        $disk = Storage::disk('public');
        $over = collect($this->before)->filter(fn (string $path, int|string $width): bool => $disk->size($path) > $this->processor->budgetBytes((int) $width));
        expect($over->keys()->all())->toContain(640)->toContain(1080)->not->toContain(320);

        $this->artisan('media:recompress')->assertSuccessful();

        $after = $this->noisy->refresh()->variants;
        $original = Storage::disk('local')->get($this->noisy->original_path);

        foreach ($this->before as $width => $path) {
            if ($over->has($width)) {
                expect($after[$width])->not->toBe($path)
                    ->and($disk->exists($path))->toBeFalse()
                    ->and($disk->get($after[$width]))->toBe($this->processor->variant($original, (int) $width))
                    ->and($disk->size($after[$width]))->toBeLessThan(strlen(budgetWebp($original, (int) $width, 80)))
                    ->and(budgetSize($disk->get($after[$width]))[0])->toBe((int) $width);
            } else {
                expect($after[$width])->toBe($path)->and($disk->exists($path))->toBeTrue();
            }
        }

        expect($this->noisy->variant_bytes)->toBe(collect($after)->sum(fn (string $path): int => $disk->size($path)))
            ->and($this->plain->refresh()->variants)->toBe($this->plainBefore);

        // A second run finds the floor encodings again and changes nothing.
        $this->artisan('media:recompress')->expectsOutputToContain('0 encoded again')->assertSuccessful();

        expect($this->noisy->refresh()->variants)->toBe($after);
    });

    it('leaves deleted and unfinished photos alone', function () {
        $this->noisy->delete();
        $this->service->withdraw($this->noisy);

        $this->artisan('media:recompress')->expectsOutputToContain('0 variants of 0 photos')->assertSuccessful();
    });

    it('stops after --limit photos', function () {
        config(['speedclub.media.variant_budget_kb' => []]);
        $second = storeBudgetPhoto($this->service, $this->owner, $this->vehicle, TestImages::noisyJpeg(seed: 419));
        config(['speedclub.media.variant_budget_kb' => $this->budgets]);
        $secondBefore = $second->variants;

        $this->artisan('media:recompress', ['--limit' => 1])->expectsOutputToContain('of 1 photos')->assertSuccessful();

        expect([$this->noisy->refresh()->variants !== $this->before, $second->refresh()->variants !== $secondBefore])
            ->toContain(true)->toContain(false);
    });
});
