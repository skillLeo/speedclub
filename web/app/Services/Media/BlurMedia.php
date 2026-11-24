<?php

namespace App\Services\Media;

use App\Enums\MediaStatus;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\OgImages;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * [SIG sig.plate_blur] The queued half of PATCH media/{id} with blur_regions (BlurPhoto): pixelates the regions into the private original
 * and draws every variant again from it. Idempotent: a retry finds the regions still waiting and starts from the stored original, which is
 * only replaced once the new files are written. Well under the worker's 50 s for the largest photo the upload rules allow.
 */
class BlurMedia implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [30, 120];

    public function __construct(public readonly string $mediaId) {}

    public function uniqueId(): string
    {
        return $this->mediaId;
    }

    public function handle(MediaService $service): void
    {
        $media = Media::query()->find($this->mediaId);

        if ($media === null || $media->status === MediaStatus::Failed) {
            return;
        }

        // No regions waiting: done before, perhaps up to a crash before the clean-up of the old files, which tidy() finishes.
        if (! is_array($media->getAttribute('blur_regions'))) {
            $service->tidy($media);

            return;
        }

        $service->blur($media);

        $parent = $media->mediable;

        // The OG image and the share cards were purged with the request; they are drawn again from the pixelated photo.
        if ($parent instanceof Vehicle) {
            app(OgImages::class)->queue($parent);
        }

        if ($parent instanceof User) {
            app(OgImages::class)->queue($parent);
        }
    }

    /**
     * All retries used up: nothing unblurred may stay behind, so the photo fails, as an upload that never finished does, and the owner
     * deletes it on GAR-07 or uploads it again.
     */
    public function failed(?Throwable $exception): void
    {
        $media = Media::query()->find($this->mediaId);

        if ($media !== null && $media->status === MediaStatus::Processing) {
            app(MediaService::class)->markFailed($media);
        }
    }
}
