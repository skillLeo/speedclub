<?php

namespace App\Services\Media;

use App\Enums\ErrorCode;
use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\PlateBlurState;
use App\Exceptions\ApiException;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\BuildScore\BuildScores;
use finfo;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\UploadedFile;
use Illuminate\Image\ImageException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

/**
 * The only way user images enter the system (05_ARCHITECTURE §9). Layout on both disks: media/{id}/…, with a content
 * hash in every file name, so URLs can be cached forever and deleting a directory removes all of a photo.
 *
 * @phpstan-type MediaAttributes array{alt?: string|null, focal_x?: float|null, focal_y?: float|null, category?: MediaCategory|string|null, sort?: int}
 */
class MediaService
{
    private const PENDING_FILE = 'pending.bin';

    /** @var array<string, int> */
    private const IMAGE_TYPES = [
        'image/jpeg' => IMAGETYPE_JPEG,
        'image/png' => IMAGETYPE_PNG,
        'image/webp' => IMAGETYPE_WEBP,
    ];

    public function __construct(private readonly ImageProcessor $processor) {}

    /**
     * @param  MediaAttributes  $attributes
     *
     * @throws ApiException 413 too large, 415 anything that is not a decodable JPEG, PNG or WebP
     */
    public function storeFromUpload(UploadedFile $file, User $owner, ?Model $mediable = null, array $attributes = [], ?PlateBlurChoice $plateBlur = null): Media
    {
        $bytes = $this->inspectUpload($file);

        return $this->processOrQueue($this->reserve($owner, $mediable, $attributes, strlen($bytes), plateBlur: $plateBlur), $bytes);
    }

    /**
     * For seeders and imports: same checks and same pipeline as an upload, with the plate decision an upload would carry (M5.9f: the
     * showcase passes ShowcasePlates' decision; null = `unchecked`).
     *
     * @param  MediaAttributes  $attributes
     *
     * @throws ApiException 413 too large, 415 anything that is not a decodable JPEG, PNG or WebP
     */
    public function storeFromPath(string $path, User $owner, ?Model $mediable = null, array $attributes = [], ?PlateBlurChoice $plateBlur = null): Media
    {
        $bytes = $this->inspectPath($path);

        return $this->processOrQueue($this->reserve($owner, $mediable, $attributes, strlen($bytes), plateBlur: $plateBlur), $bytes);
    }

    /**
     * @return string the checked bytes, for processOrQueue()
     */
    public function inspectUpload(UploadedFile $file): string
    {
        if (! $file->isValid()) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['file' => [(string) __('media.upload_failed')]]);
        }

        return $this->inspect($file->getContent());
    }

    /**
     * @return string the checked bytes, for processOrQueue()
     */
    public function inspectPath(string $path): string
    {
        $bytes = is_file($path) ? file_get_contents($path) : false;

        if ($bytes === false) {
            throw new InvalidArgumentException("No readable file at [$path].");
        }

        return $this->inspect($bytes);
    }

    /**
     * Creates the row in status processing. Callers that enforce a limit call this inside their transaction and
     * process outside of it, so no lock is held during the image work.
     *
     * @param  MediaAttributes  $attributes
     * @param  int  $bytes  size of the upload, which holds its place against the member's allowance until the work is done
     * @param  PlateBlurChoice|null  $plateBlur  M5.9a: the member's switch and rectangles (ValidatesPlateBlur); null = not sent, `unchecked`.
     *                                           Blurred: the regions wait in blur_regions until process() pixelates them into the master.
     *
     * @throws ApiException 422 above the member's storage allowance
     */
    public function reserve(User $owner, ?Model $mediable = null, array $attributes = [], int $bytes = 0, ?string $disk = null, ?PlateBlurChoice $plateBlur = null): Media
    {
        $plateBlur ??= PlateBlurChoice::unchecked();

        $this->assertWithinQuota($owner, $bytes);

        $media = new Media;
        $media->fill(array_filter($attributes, fn (mixed $value): bool => $value !== null));
        $media->forceFill([
            'owner_id' => $owner->id,
            'mediable_type' => $mediable?->getMorphClass(),
            'mediable_id' => $mediable?->getKey(),
            // $disk: where the variants go. Chat photos keep them on the private disk, served by signed URLs (M2.4 review #5).
            'disk' => $disk ?? config()->string('speedclub.media.disk'),
            'status' => MediaStatus::Processing,
            'moderation_status' => ModerationStatus::Pending,
            'category' => $attributes['category'] ?? MediaCategory::Other,
            'sort' => $attributes['sort'] ?? 0,
            'original_bytes' => $bytes,
            'variant_bytes' => 0,
            'plate_blur' => $plateBlur->state,
            'blur_regions' => $plateBlur->state === PlateBlurState::Blurred && $plateBlur->regions !== [] ? $plateBlur->regions : null,
        ]);
        $media->save();

        return $media;
    }

    /**
     * What a member's photos take on the disks. Deleted ones count with their private original until the hard delete, or
     * uploading and deleting in turns would fill the disk past any allowance.
     */
    public function bytesUsedBy(User $owner): int
    {
        return (int) Media::withTrashed()->where('owner_id', $owner->id)->sum(DB::raw('original_bytes + variant_bytes'));
    }

    /**
     * No lock of its own. Uploads to a vehicle or a modification hold the member's row by now, the first lock of every action, because
     * the insert into media needs a shared lock on that row through media.owner_id. Only a profile photo and a seeder reserve without it, which
     * can pass together with a parallel upload; each is limited by max_upload_mb and throttle:uploads.
     */
    private function assertWithinQuota(User $owner, int $bytes): void
    {
        $verified = $owner->hasVerifiedEmail();
        $quota = config()->integer($verified ? 'speedclub.media.quota_mb' : 'speedclub.media.quota_unverified_mb');

        if ($this->bytesUsedBy($owner) + $bytes > $quota * 1024 * 1024) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['file' => [
                (string) __($verified ? 'media.quota_reached' : 'media.quota_reached_unverified'),
            ]]);
        }
    }

    /**
     * In-request processing. A file GD cannot decode is the client's error: the row goes and the answer is 415.
     * Everything else (a full disk, a storage hiccup) is ours: the bytes wait privately for a queued retry. M5.9a: once the picture is
     * rendered, what waits is the rendered master, with any plate already pixelated, never the upload; only a failure before that (GD
     * itself) leaves the upload's bytes in the private pending file, which the retry or the job's failed() deletes.
     */
    public function processOrQueue(Media $media, string $bytes): Media
    {
        try {
            $image = $this->render($media, $bytes);
        } catch (ImageException) {
            $this->purge($media);

            throw $this->unsupported();
        } catch (Throwable $exception) {
            report($exception);

            return $this->queue($media, $bytes);
        }

        try {
            return $this->store($media, $image);
        } catch (Throwable $exception) {
            report($exception);

            // The regions are in the master now: the retry must not count on them again, and the photo stays marked as pixelated.
            $media->forceFill([
                'blur_regions' => null,
                'blurred_at' => is_array($media->getAttribute('blur_regions')) ? now() : $media->getAttribute('blurred_at'),
            ])->save();

            return $this->queue($media, $image->jpeg);
        }
    }

    /**
     * Idempotent: the same bytes end up under the same names, so a retry overwrites an earlier partial attempt. Pixelates the regions
     * waiting in blur_regions (an upload with plate_blur=1, or GAR-08) into the decoded picture before anything is written.
     */
    public function process(Media $media, string $bytes): Media
    {
        return $this->store($media, $this->render($media, $bytes));
    }

    /**
     * Decode, orient, pixelate the waiting regions, encode the master and draw every variant and the blurhash from it. In memory only:
     * nothing is written here.
     *
     * @throws ImageException when the bytes do not decode as an image
     */
    private function render(Media $media, string $bytes): ProcessedImage
    {
        return $this->processor->process($bytes, $this->waitingRegions($media));
    }

    /**
     * Writes the master first and deletes the pending upload in the same step, then the variants, then points the row at them (the regions
     * done) and removes every other file of the photo: a stale original or variant from before a GAR-08 pixelation or a failed attempt.
     */
    private function store(Media $media, ProcessedImage $image): Media
    {
        $directory = $this->directory($media);
        $originalPath = $directory.'/'.$this->hash($image->jpeg).'.jpg';

        $this->assertWritten($this->privateDisk()->put($originalPath, $image->jpeg), $originalPath);
        // The pending upload's bytes are never needed again: the master replaces them (m5.9a-contract §2).
        $this->deletePending($media);

        $variants = [];

        foreach ($image->variants as $width => $webp) {
            $path = $directory.'/'.$this->hash($webp).'-'.$width.'.webp';
            $this->assertWritten($this->publicDisk($media)->put($path, $webp, ['visibility' => 'public']), $path);
            $variants[(string) $width] = $path;
        }

        $pixelated = $this->waitingRegions($media) !== [];

        $media->forceFill([
            'original_path' => $originalPath,
            'variants' => $variants,
            'width' => $image->width,
            'height' => $image->height,
            'blurhash' => $image->blurhash,
            'status' => MediaStatus::Ready,
            'original_bytes' => strlen($image->jpeg),
            'variant_bytes' => array_sum(array_map(strlen(...), $image->variants)),
            'blur_regions' => null,
            'blurred_at' => $pixelated ? now() : $media->getAttribute('blurred_at'),
        ])->save();

        $this->keepOnlyCurrentFiles($media);

        // The member deleted the photo while this ran (soft, or already purged): nothing may stay public behind their back.
        if (! Media::query()->whereKey($media->getKey())->exists()) {
            $this->withdraw($media);

            return $media;
        }

        $this->adoptAsCover($media);
        // M5.9c: a finished photo counts for the Build Score of its car (gallery, mod or build update).
        app(BuildScores::class)->touchFor($media->getAttribute('mediable_type'), $media->getAttribute('mediable_id'));

        return $media;
    }

    /**
     * Queue path of process(): reads the waiting bytes; store() removes them with the first write.
     */
    public function retry(Media $media): void
    {
        $bytes = $this->privateDisk()->get($this->pendingPath($media));

        if ($bytes === null) {
            throw new RuntimeException("The pending upload of media [{$media->getKey()}] is gone.");
        }

        $this->process($media, $bytes);
    }

    /**
     * After a crash between the new files and the clean-up: removes what does not belong to the photo's current state.
     */
    public function tidy(Media $media): void
    {
        if ($media->status === MediaStatus::Ready && is_string($media->getAttribute('original_path'))) {
            $this->keepOnlyCurrentFiles($media);
        }
    }

    private function queue(Media $media, string $bytes): Media
    {
        $this->privateDisk()->put($this->pendingPath($media), $bytes);
        ProcessMedia::dispatch((string) $media->getKey());

        return $media;
    }

    private function pendingPath(Media $media): string
    {
        return $this->directory($media).'/'.self::PENDING_FILE;
    }

    private function deletePending(Media $media): void
    {
        $path = $this->pendingPath($media);

        if ($this->privateDisk()->exists($path) && ! $this->privateDisk()->delete($path)) {
            throw new RuntimeException("Could not remove [$path].");
        }
    }

    /**
     * @return list<array{x: float|int, y: float|int, w: float|int, h: float|int, angle?: float|int}>
     */
    private function waitingRegions(Media $media): array
    {
        $regions = $media->getAttribute('blur_regions');

        /** @var list<array{x: float|int, y: float|int, w: float|int, h: float|int, angle?: float|int}> */
        return is_array($regions) ? array_values($regions) : [];
    }

    /**
     * [SIG sig.plate_blur] GAR-08: pixelates the waiting blur_regions into the private original and draws every variant and the blurhash
     * again from it, under new content-hash names, so old variant URLs stop working (immutable caching, ADR-123). store() then removes
     * every other file of the photo from both disks: the pre-blur original is discarded (02_PRODUCT_SPEC §5) and nothing unblurred
     * survives. Same block rule as an upload (Pixelator, ADR-509). A retry after a crash in between finds the regions done and BlurMedia
     * tidies what is left.
     */
    public function blur(Media $media): Media
    {
        $original = $media->getAttribute('original_path');
        $bytes = is_string($original) ? $this->privateDisk()->get($original) : null;

        if ($bytes === null) {
            throw new RuntimeException("The original of media [{$media->getKey()}] is gone, so it cannot be pixelated.");
        }

        return $this->process($media, $bytes);
    }

    /**
     * Deletes every file of the photo's directory, on both disks, that is not its current original or one of its current variants. A chat
     * photo keeps both on the private disk, so the files to keep are one list for every disk.
     */
    private function keepOnlyCurrentFiles(Media $media): void
    {
        $directory = $this->directory($media);
        /** @var array<int|string, string> $variants */
        $variants = $media->getAttribute('variants') ?? [];
        $keep = [$media->getAttribute('original_path'), ...array_values($variants)];

        foreach (array_unique([config()->string('speedclub.media.private_disk'), $this->diskName($media)]) as $disk) {
            foreach (Storage::disk($disk)->allFiles($directory) as $file) {
                if (! in_array($file, $keep, true) && ! Storage::disk($disk)->delete($file)) {
                    throw new RuntimeException("Could not remove [$file].");
                }
            }
        }
    }

    /**
     * All retries used up. Nothing of the raw upload stays behind.
     */
    public function markFailed(Media $media): void
    {
        $this->removeFiles($media);
        $media->forceFill(['status' => MediaStatus::Failed, 'variants' => null, 'original_path' => null, 'original_bytes' => 0, 'variant_bytes' => 0, 'blur_regions' => null])->save();
        app(BuildScores::class)->touchFor($media->getAttribute('mediable_type'), $media->getAttribute('mediable_id'));
    }

    /**
     * Permanent removal for pruning and rejected files. Members delete softly through DeleteMedia.
     */
    public function purge(Media $media): void
    {
        $this->removeFiles($media);
        $media->forceDelete();
    }

    /**
     * A deleted photo stops being served at once: its public files go now, only the private original waits for the hard
     * delete. A restore therefore has to process the original again. A failed delete keeps the paths, so media:prune tries
     * again.
     */
    public function withdraw(Media $media): bool
    {
        if (! $this->publicDisk($media)->deleteDirectory($this->directory($media))) {
            report(new RuntimeException("Could not remove the public files of deleted media [{$media->getKey()}]."));

            return false;
        }

        $media->forceFill(['variants' => null, 'variant_bytes' => 0])->save();

        return true;
    }

    /**
     * A withdrawn photo comes back (a reversed moderation removal, M3.2): its variants are drawn again from the private original, as
     * ADR-123 says a restore must. Nothing happens for a photo that still has its variants, is deleted, or has no original any more.
     */
    public function republish(Media $media): bool
    {
        $original = $media->getAttribute('original_path');

        if ($media->trashed() || $media->status !== MediaStatus::Ready || ! is_string($original) || $media->getAttribute('variants') !== null) {
            return false;
        }

        $bytes = $this->privateDisk()->get($original);

        if ($bytes === null) {
            return false;
        }

        // Re-encoding the original gives it a new content-hash name: store() removes the previous file.
        $this->process($media, $bytes);

        return true;
    }

    /**
     * M4.18: encodes again every stored variant above its byte budget (ImageProcessor::budgetBytes()), from the private original as
     * process() does, under a new content-hash name. A variant is only replaced by a smaller one, so a second run changes nothing:
     * a photo already at variant_min_quality encodes to the same bytes and stays. The old file goes after the row points at the
     * new one; a photo blurred, withdrawn or encoded again in between keeps what that wrote.
     *
     * @return array{over: int, replaced: int, saved_bytes: int} variants above the budget, of them replaced, bytes saved
     */
    public function recompressVariants(Media $media, bool $dryRun = false): array
    {
        $result = ['over' => 0, 'replaced' => 0, 'saved_bytes' => 0];
        /** @var array<int|string, string> $variants */
        $variants = $media->getAttribute('variants') ?? [];
        $original = $media->getAttribute('original_path');
        $disk = $this->publicDisk($media);
        $jpeg = null;

        foreach ($variants as $width => $path) {
            $size = $disk->exists($path) ? $disk->size($path) : null;

            if ($size === null || $size <= $this->processor->budgetBytes((int) $width)) {
                continue;
            }

            $result['over']++;

            if ($dryRun) {
                continue;
            }

            $jpeg ??= is_string($original) ? $this->privateDisk()->get($original) : null;

            if ($jpeg === null) {
                report(new RuntimeException("The original of media [{$media->getKey()}] is gone, so its variants cannot be encoded again."));

                break;
            }

            $webp = $this->processor->variant($jpeg, (int) $width);

            if (strlen($webp) >= $size) {
                continue;
            }

            $newPath = $this->directory($media).'/'.$this->hash($webp).'-'.$width.'.webp';
            $this->assertWritten($disk->put($newPath, $webp, ['visibility' => 'public']), $newPath);

            $swapped = DB::transaction(function () use ($media, $width, $path, $newPath, $size, $webp): bool {
                $current = Media::query()->whereKey($media->getKey())->lockForUpdate()->first();
                /** @var array<int|string, string>|null $currentVariants */
                $currentVariants = $current?->getAttribute('variants');

                if ($current === null || ($currentVariants[$width] ?? null) !== $path) {
                    return false;
                }

                $currentVariants[$width] = $newPath;
                $current->forceFill([
                    'variants' => $currentVariants,
                    'variant_bytes' => max(0, (int) $current->getAttribute('variant_bytes') - $size + strlen($webp)),
                ])->save();
                $media->setRawAttributes($current->getAttributes(), true);

                return true;
            });

            if (! $swapped) {
                $disk->delete($newPath);

                break;
            }

            $disk->delete($path);
            $result['replaced']++;
            $result['saved_bytes'] += $size - strlen($webp);
        }

        return $result;
    }

    /**
     * @return array<int, string> URL by pixel width, smallest first
     */
    public function variantUrls(Media $media): array
    {
        /** @var array<int|string, string> $variants */
        $variants = $media->getAttribute('variants') ?? [];
        $urls = [];

        foreach ($variants as $width => $path) {
            $urls[(int) $width] = $this->url($this->diskName($media), $path);
        }

        ksort($urls);

        return $urls;
    }

    /**
     * Bytes of the widest public variant, which never holds the metadata of the original. Null when there is none.
     */
    public function largestVariant(Media $media): ?string
    {
        /** @var array<int|string, string> $variants */
        $variants = $media->getAttribute('variants') ?? [];

        if ($variants === []) {
            return null;
        }

        krsort($variants, SORT_NUMERIC);

        return $this->publicDisk($media)->get((string) reset($variants));
    }

    /**
     * Local disks answer on the host of the current request, so LAN clients get reachable URLs whatever APP_URL says.
     */
    private function url(string $disk, string $path): string
    {
        return config('filesystems.disks.'.$disk.'.driver') === 'local'
            ? url('storage/'.$path)
            : Storage::disk($disk)->url($path);
    }

    private function inspect(string $bytes): string
    {
        $maximum = config()->integer('speedclub.media.max_upload_mb');

        if (strlen($bytes) > $maximum * 1024 * 1024) {
            $message = (string) __('media.too_large', ['max' => $maximum]);

            throw new ApiException(ErrorCode::PayloadTooLarge, $message, ['file' => [$message]]);
        }

        // The client's file name and Content-Type are never consulted. finfo and the image header must agree.
        $mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        /** @var list<string> $allowed */
        $allowed = config('speedclub.media.allowed_mimes');

        if (! is_string($mime) || ! in_array($mime, $allowed, true) || ! isset(self::IMAGE_TYPES[$mime])) {
            throw $this->unsupported();
        }

        $size = @getimagesizefromstring($bytes);

        if ($size === false || $size[2] !== self::IMAGE_TYPES[$mime] || $size[0] < 1 || $size[1] < 1) {
            throw $this->unsupported();
        }

        if (config()->integer('speedclub.media.max_pixels') < $size[0] * $size[1]) {
            $message = (string) __('media.too_many_pixels');

            throw new ApiException(ErrorCode::UnsupportedMediaType, $message, ['file' => [$message]]);
        }

        return $bytes;
    }

    /**
     * A vehicle without a cover gets its first finished photo. The conditional update keeps a concurrent choice.
     */
    private function adoptAsCover(Media $media): void
    {
        if ($media->getAttribute('mediable_type') === (new Vehicle)->getMorphClass()) {
            Vehicle::query()
                ->whereKey($media->getAttribute('mediable_id'))
                ->whereNull('cover_media_id')
                ->update(['cover_media_id' => $media->getKey()]);
        }
    }

    private function unsupported(): ApiException
    {
        $message = (string) __('media.unsupported');

        return new ApiException(ErrorCode::UnsupportedMediaType, $message, ['file' => [$message]]);
    }

    private function removeFiles(Media $media): void
    {
        $this->privateDisk()->deleteDirectory($this->directory($media));
        $this->publicDisk($media)->deleteDirectory($this->directory($media));
    }

    private function directory(Media $media): string
    {
        return 'media/'.strtolower((string) $media->getKey());
    }

    private function hash(string $bytes): string
    {
        return substr(hash('sha256', $bytes), 0, 16);
    }

    /**
     * The disks are configured with throw = false, so a failed write only shows in the return value.
     */
    private function assertWritten(string|bool $result, string $path): void
    {
        if ($result === false) {
            throw new RuntimeException("Could not write [$path].");
        }
    }

    private function privateDisk(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.media.private_disk'));
    }

    private function publicDisk(Media $media): Filesystem
    {
        return Storage::disk($this->diskName($media));
    }

    private function diskName(Media $media): string
    {
        $disk = $media->getAttribute('disk');

        return is_string($disk) ? $disk : config()->string('speedclub.media.disk');
    }
}
