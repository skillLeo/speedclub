<?php

namespace App\Services\Media;

use App\Enums\MediaStatus;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdates;
use App\Services\PublicPages\OgImages;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Queued retry after an in-request failure (05_ARCHITECTURE §9). Idempotent, and well below the 50 s cron window.
 */
class ProcessMedia implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [60, 300];

    public function __construct(public readonly string $mediaId) {}

    public function handle(MediaService $service): void
    {
        $media = Media::query()->find($this->mediaId);

        if ($media !== null && $media->status === MediaStatus::Processing) {
            $service->retry($media);

            // The member deleted the photo while it was processed: retry() took its files back, and nothing changed on the build.
            if (! Media::query()->whereKey($media->getKey())->exists()) {
                return;
            }

            // What an upload does when it finishes in the request.
            $parent = $media->mediable;

            if ($parent instanceof Vehicle) {
                app(BuildUpdates::class)->photoAdded($parent);
                app(VehicleSearchProjector::class)->changed($parent);
                app(OgImages::class)->queue($parent);
            }

            if ($parent instanceof Modification) {
                app(VehicleSearchProjector::class)->changed($parent->vehicle);
            }
        }
    }

    public function failed(?Throwable $exception): void
    {
        $media = Media::query()->find($this->mediaId);

        if ($media !== null && $media->status === MediaStatus::Processing) {
            app(MediaService::class)->markFailed($media);
        }
    }
}
