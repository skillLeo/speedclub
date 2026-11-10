<?php

use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\ImageProcessor;
use App\Services\Media\MediaService;
use App\Services\Media\ProcessMedia;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use kornrunner\Blurhash\Blurhash;
use Tests\Support\TestImages;

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    $this->owner = User::factory()->create();
    $this->vehicle = Vehicle::factory()->for($this->owner, 'owner')->create();
    $this->service = app(MediaService::class);
});

function upload(string $bytes, string $name = 'photo.jpg'): UploadedFile
{
    return UploadedFile::fake()->createWithContent($name, $bytes);
}

/**
 * @return array<string, mixed>
 */
function exifOf(string $bytes): array
{
    $path = tempnam(sys_get_temp_dir(), 'exif');
    file_put_contents($path, $bytes);
    $exif = @exif_read_data($path);
    unlink($path);

    return $exif === false ? [] : $exif;
}

it('removes GPS and every other metadata from all outputs', function () {
    $source = TestImages::jpegWithGps();

    // The fixture really carries what must disappear.
    expect(exifOf($source))->toHaveKey('GPSLatitude')->toHaveKey('Orientation')
        ->and($source)->toContain('Exif');

    $media = $this->service->storeFromUpload(upload($source), $this->owner, $this->vehicle);

    $original = Storage::disk('local')->get($media->original_path);

    expect(exifOf($original))->not->toHaveKey('GPSLatitude')->not->toHaveKey('Orientation')
        ->and($original)->not->toContain('Exif')
        ->and($original)->not->toContain('GPS');

    foreach ($media->variants as $path) {
        $webp = Storage::disk('public')->get($path);

        expect($webp)->not->toContain('Exif')
            ->and($webp)->not->toContain('EXIF')
            ->and($webp)->not->toContain('XMP ')
            ->and(substr($webp, 0, 4))->toBe('RIFF')
            ->and(substr($webp, 8, 4))->toBe('WEBP');
    }
});

it('creates four WebP variants that keep the aspect ratio', function () {
    $media = $this->service->storeFromUpload(upload(TestImages::jpeg(2400, 1600)), $this->owner, $this->vehicle);

    expect(array_keys($media->variants))->toBe([320, 640, 1080, 1600])
        ->and($media->width)->toBe(2400)
        ->and($media->height)->toBe(1600)
        ->and($media->status)->toBe(MediaStatus::Ready);

    foreach ($media->variants as $width => $path) {
        $size = getimagesizefromstring(Storage::disk('public')->get($path));

        expect($size[0])->toBe($width)
            ->and($size[1])->toBe((int) round($width * 1600 / 2400))
            ->and($size['mime'])->toBe('image/webp');
    }
});

it('never upscales', function () {
    $media = $this->service->storeFromUpload(upload(TestImages::jpeg(800, 600)), $this->owner, $this->vehicle);

    expect(array_keys($media->variants))->toBe([320, 640, 800])
        ->and(getimagesizefromstring(Storage::disk('public')->get($media->variants['800']))[0])->toBe(800);

    $tiny = $this->service->storeFromUpload(upload(TestImages::jpeg(100, 80)), $this->owner, $this->vehicle);

    expect(array_keys($tiny->variants))->toBe([100]);
});

it('applies the EXIF orientation to the pixels', function () {
    $media = $this->service->storeFromUpload(upload(TestImages::jpegWithGps(1200, 800, 6)), $this->owner, $this->vehicle);

    expect($media->width)->toBe(800)->and($media->height)->toBe(1200);

    // Orientation 6 means "rotate 90° clockwise": the red left half of the fixture ends up on top.
    $image = imagecreatefromstring(Storage::disk('local')->get($media->original_path));
    $top = imagecolorsforindex($image, imagecolorat($image, 400, 100));
    $bottom = imagecolorsforindex($image, imagecolorat($image, 400, 1100));

    expect($top['red'])->toBeGreaterThan($top['blue'])
        ->and($bottom['blue'])->toBeGreaterThan($bottom['red']);
});

it('stores the original privately and only hashed file names publicly', function () {
    $media = $this->service->storeFromUpload(upload(TestImages::jpeg(), 'mein-kennzeichen.jpg'), $this->owner, $this->vehicle);

    Storage::disk('local')->assertExists($media->original_path);
    Storage::disk('public')->assertMissing($media->original_path);

    $files = Storage::disk('public')->allFiles();

    expect($files)->toHaveCount(4)
        ->and(getimagesizefromstring(Storage::disk('local')->get($media->original_path))['mime'])->toBe('image/jpeg');

    foreach ($files as $file) {
        expect($file)->toMatch('/^media\/[0-9a-z]{26}\/[0-9a-f]{16}-\d+\.webp$/')
            ->not->toContain('kennzeichen');
    }
});

it('produces a blurhash that decodes to the colours of the photo', function () {
    $media = $this->service->storeFromUpload(upload(TestImages::jpeg(1600, 1600)), $this->owner, $this->vehicle);

    expect(strlen($media->blurhash))->toBeLessThanOrEqual(64);

    $pixels = Blurhash::decode($media->blurhash, 8, 8);

    // Left half red, right half blue in the fixture.
    expect($pixels[4][0][0])->toBeGreaterThan($pixels[4][0][2])
        ->and($pixels[4][7][2])->toBeGreaterThan($pixels[4][7][0]);
});

it('accepts PNG and WebP and keeps the attributes', function (string $bytes) {
    $media = $this->service->storeFromUpload(upload($bytes), $this->owner, $this->vehicle, [
        'alt' => 'Front', 'focal_x' => 0.25, 'focal_y' => 0.75, 'category' => MediaCategory::Wheels, 'sort' => 3,
    ]);

    $media->refresh();

    expect($media->status)->toBe(MediaStatus::Ready)
        ->and($media->alt)->toBe('Front')
        ->and($media->focal_x)->toBe(0.25)
        ->and($media->focal_y)->toBe(0.75)
        ->and($media->category)->toBe(MediaCategory::Wheels)
        ->and($media->sort)->toBe(3)
        ->and($media->owner_id)->toBe($this->owner->id)
        ->and($media->mediable_id)->toBe($this->vehicle->id);
})->with([
    'png' => fn () => TestImages::png(),
    'webp' => fn () => TestImages::webp(),
]);

it('runs the same pipeline from a path', function () {
    $path = tempnam(sys_get_temp_dir(), 'seed');
    file_put_contents($path, TestImages::jpegWithGps());

    $media = $this->service->storeFromPath($path, $this->owner, $this->vehicle, ['alt' => 'Seed']);
    unlink($path);

    expect($media->status)->toBe(MediaStatus::Ready)
        ->and($media->alt)->toBe('Seed')
        ->and(array_keys($media->variants))->toBe([320, 640, 1080, 1600])
        ->and(exifOf(Storage::disk('local')->get($media->original_path)))->not->toHaveKey('GPSLatitude');

    expect(fn () => $this->service->storeFromPath($path, $this->owner))->toThrow(InvalidArgumentException::class);
});

it('rejects anything that is not really a JPEG, PNG or WebP, whatever it is called', function (string $bytes, string $name) {
    $error = null;

    try {
        $this->service->storeFromUpload(upload($bytes, $name), $this->owner, $this->vehicle);
    } catch (ApiException $exception) {
        $error = $exception;
    }

    expect($error?->errorCode->value)->toBe('unsupported_media_type')
        ->and(Media::query()->count())->toBe(0)
        ->and(Storage::disk('public')->allFiles())->toBe([])
        ->and(Storage::disk('local')->allFiles())->toBe([]);
})->with([
    'php renamed to jpg' => ['<?php system($_GET["c"]);', 'shell.jpg'],
    'html renamed to png' => ['<html><script>alert(1)</script></html>', 'page.png'],
    'svg' => ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'logo.svg'],
    'svg renamed to jpg' => ['<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', 'logo.jpg'],
    'jpeg magic bytes followed by php' => ["\xFF\xD8\xFF\xE0<?php system(\$_GET['c']);", 'polyglot.jpg'],
    'png magic bytes followed by html' => ["\x89PNG\r\n\x1A\n<html></html>", 'polyglot.png'],
    'text' => ['just some text', 'photo.webp'],
    'gif' => [fn () => TestImages::gif(), 'photo.jpg'],
    'bmp header' => ["BM\x46\x00\x00\x00\x00\x00\x00\x00\x36\x00\x00\x00", 'photo.jpg'],
]);

it('neutralises a real image with a payload appended', function () {
    $payload = '<?php system($_GET["c"]); ?>';
    $polyglot = TestImages::jpeg(800, 600).$payload;

    // finfo and the image header are fine with it: only the re-encode can deal with this.
    $media = $this->service->storeFromUpload(upload($polyglot), $this->owner, $this->vehicle);

    expect(Storage::disk('local')->get($media->original_path))->not->toContain('system(');

    foreach ($media->variants as $path) {
        expect(Storage::disk('public')->get($path))->not->toContain('system(');
    }
});

it('rejects a file over the size limit with 413', function () {
    config(['speedclub.media.max_upload_mb' => 0]);

    try {
        $this->service->storeFromUpload(upload(TestImages::jpeg(32, 32)), $this->owner);
        $this->fail('Expected an exception.');
    } catch (ApiException $exception) {
        expect($exception->errorCode->status())->toBe(413)
            ->and($exception->errors)->toHaveKey('file');
    }
});

it('rejects a decompression bomb before decoding it', function () {
    config(['speedclub.media.max_pixels' => 100]);

    expect(fn () => $this->service->storeFromUpload(upload(TestImages::jpeg(32, 32)), $this->owner))
        ->toThrow(ApiException::class);
});

it('makes the first finished photo the cover and leaves an existing cover alone', function () {
    $first = $this->service->storeFromUpload(upload(TestImages::jpeg(64, 64)), $this->owner, $this->vehicle);
    expect($this->vehicle->refresh()->cover_media_id)->toBe($first->id);

    $this->service->storeFromUpload(upload(TestImages::jpeg(64, 64)), $this->owner, $this->vehicle);
    expect($this->vehicle->refresh()->cover_media_id)->toBe($first->id);
});

it('queues a retry when processing fails for a reason on our side', function () {
    Queue::fake();
    $source = TestImages::jpegWithGps(800, 600);

    $broken = Mockery::mock(ImageProcessor::class);
    $broken->shouldReceive('process')->andThrow(new RuntimeException('disk full'));
    $service = new MediaService($broken);

    $media = $service->storeFromUpload(upload($source), $this->owner, $this->vehicle);

    expect($media->status)->toBe(MediaStatus::Processing)
        ->and($media->variants)->toBeNull()
        ->and(Storage::disk('public')->allFiles())->toBe([]);

    Queue::assertPushed(ProcessMedia::class, fn (ProcessMedia $job): bool => $job->mediaId === $media->id);

    // The retry runs the normal pipeline and removes the waiting raw file.
    (new ProcessMedia($media->id))->handle(app(MediaService::class));
    $media->refresh();

    expect($media->status)->toBe(MediaStatus::Ready)
        ->and(array_keys($media->variants))->toBe([320, 640, 800])
        ->and(collect(Storage::disk('local')->allFiles())->filter(fn (string $file): bool => str_contains($file, 'pending')))->toBeEmpty()
        ->and($this->vehicle->refresh()->cover_media_id)->toBe($media->id);
});

it('is idempotent when a retry runs twice', function () {
    $media = $this->service->reserve($this->owner, $this->vehicle);
    $bytes = TestImages::jpeg(800, 600);

    $this->service->process($media, $bytes);
    $variants = $media->variants;
    $this->service->process($media, $bytes);

    expect($media->variants)->toBe($variants)
        ->and(Storage::disk('public')->allFiles())->toHaveCount(3);
});

it('marks the photo failed and removes the raw upload when all retries are used up', function () {
    Queue::fake();
    $broken = Mockery::mock(ImageProcessor::class);
    $broken->shouldReceive('process')->andThrow(new RuntimeException('disk full'));

    $media = (new MediaService($broken))->storeFromUpload(upload(TestImages::jpeg(64, 64)), $this->owner, $this->vehicle);
    expect(Storage::disk('local')->allFiles())->toHaveCount(1);

    (new ProcessMedia($media->id))->failed(new RuntimeException('disk full'));

    expect($media->refresh()->status)->toBe(MediaStatus::Failed)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
});

it('gives media URLs on the host of the current request', function () {
    $media = $this->service->storeFromUpload(upload(TestImages::jpeg(400, 300)), $this->owner, $this->vehicle);

    expect($this->service->variantUrls($media)[320])->toStartWith(url('storage/media/'));
});

it('keeps the pixel limit at what the pipeline was measured to survive in 256M', function () {
    expect(config('speedclub.media.max_pixels'))->toBeLessThanOrEqual(12_000_000);
});

it('fails uploads stuck in processing after a killed request, and leaves recent ones alone', function () {
    $stuck = $this->service->reserve($this->owner, $this->vehicle);
    $recent = $this->service->reserve($this->owner, $this->vehicle);
    $stuck->forceFill(['created_at' => now()->subHours(25)])->save();

    $this->artisan('media:prune')->assertSuccessful();

    expect($stuck->refresh()->status)->toBe(MediaStatus::Failed)
        ->and($recent->refresh()->status)->toBe(MediaStatus::Processing);
});

it('prunes orphans and long-deleted media with their files, and nothing else', function () {
    $keep = $this->service->storeFromUpload(upload(TestImages::jpeg(64, 64)), $this->owner, $this->vehicle);
    $orphan = $this->service->storeFromUpload(upload(TestImages::jpeg(64, 64)), $this->owner);
    $freshOrphan = $this->service->storeFromUpload(upload(TestImages::jpeg(64, 64)), $this->owner);
    $deleted = $this->service->storeFromUpload(upload(TestImages::jpeg(64, 64)), $this->owner, $this->vehicle);
    $recentlyDeleted = $this->service->storeFromUpload(upload(TestImages::jpeg(64, 64)), $this->owner, $this->vehicle);

    $orphan->forceFill(['created_at' => now()->subHours(25)])->save();
    $deleted->delete();
    $deleted->forceFill(['deleted_at' => now()->subDays(31)])->save();
    $recentlyDeleted->delete();

    $this->artisan('media:prune')->assertSuccessful();

    expect(Media::withTrashed()->pluck('id')->all())
        ->toEqualCanonicalizing([$keep->id, $freshOrphan->id, $recentlyDeleted->id]);

    Storage::disk('local')->assertMissing($orphan->original_path);
    Storage::disk('public')->assertMissing($deleted->variants['64']);
    Storage::disk('public')->assertExists($keep->variants['64']);
});
