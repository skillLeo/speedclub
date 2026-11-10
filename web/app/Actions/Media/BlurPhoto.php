<?php

namespace App\Actions\Media;

use App\Enums\ErrorCode;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\Media\BlurMedia;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;

/**
 * [SIG sig.plate_blur] GAR-08 "Unkenntlich machen" (02_PRODUCT_SPEC §5, §9): stores the regions and hands the pixelation to the queue
 * (BlurMedia). Until it has run nobody sees the unblurred photo any more: its public variants go at once, it reads `processing` (others
 * see only ready photos), and the build's OG image is purged, as it may show the photo. Only the private original waits for the job, which
 * replaces it.
 */
class BlurPhoto
{
    public function __construct(
        private readonly MediaService $media,
        private readonly OgImages $og,
    ) {}

    /**
     * @param  list<array{x: float|int|string, y: float|int|string, w: float|int|string, h: float|int|string}>  $regions
     *
     * @throws ApiException 422 for a photo that is not finished or not of a vehicle or a modification
     */
    public function handle(Media $media, array $regions): Media
    {
        $parent = $media->mediable;

        if ($media->status !== MediaStatus::Ready || ! ($parent instanceof Vehicle || $parent instanceof Modification)) {
            $message = (string) __('media.blur_not_ready');

            throw new ApiException(ErrorCode::ValidationFailed, $message, ['blur_regions' => [$message]]);
        }

        $stored = array_map(fn (array $region): array => [
            'x' => round((float) $region['x'], 4),
            'y' => round((float) $region['y'], 4),
            'w' => round((float) $region['w'], 4),
            'h' => round((float) $region['h'], 4),
        ], $regions);

        $media->forceFill(['blur_regions' => $stored, 'status' => MediaStatus::Processing])->save();
        $this->media->withdraw($media);

        $this->og->purge($parent instanceof Modification ? $parent->vehicle : $parent);

        // Last: a sync queue (tests, a host without the cron worker) runs the job right here, after the old files are gone.
        BlurMedia::dispatch((string) $media->getKey());

        return $media->refresh();
    }
}
