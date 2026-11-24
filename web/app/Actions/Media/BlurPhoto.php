<?php

namespace App\Actions\Media;

use App\Enums\ErrorCode;
use App\Enums\MediaStatus;
use App\Enums\PlateBlurState;
use App\Exceptions\ApiException;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\BlurMedia;
use App\Services\Media\MediaService;
use App\Services\Media\PlateBlurChoice;
use App\Services\PublicPages\OgImages;
use App\Services\Wrapped\WrappedCardImages;

/**
 * [SIG sig.plate_blur] GAR-08 "Unkenntlich machen" (02_PRODUCT_SPEC §5, §9): stores the regions and hands the pixelation to the queue
 * (BlurMedia). Until it has run nobody sees the unblurred photo any more: its public variants go at once, it reads `processing` (others
 * see only ready photos), and the OG images and share cards that may show it are purged. Only the private original waits for the job,
 * which replaces it.
 *
 * M5.9a: also a build-update photo and a profile cover or avatar (the plate check, m5.9a-contract §4), and the photo's plate state becomes
 * `blurred` at once, so the plate check no longer lists it. Pixelation is only ever added; taking it off needs a new upload.
 */
class BlurPhoto
{
    public function __construct(
        private readonly MediaService $media,
        private readonly OgImages $og,
    ) {}

    /**
     * @param  list<array{x: float|int|string, y: float|int|string, w: float|int|string, h: float|int|string, angle?: float|int|string|null}>  $regions
     *
     * @throws ApiException 422 for a photo that is not finished or not of a vehicle, a modification, a build update or a profile
     */
    public function handle(Media $media, array $regions): Media
    {
        $parent = $media->mediable;

        if ($media->status !== MediaStatus::Ready || ! ($parent instanceof Vehicle || $parent instanceof Modification || $parent instanceof BuildUpdate || $parent instanceof User)) {
            $message = (string) __('media.blur_not_ready');

            throw new ApiException(ErrorCode::ValidationFailed, $message, ['blur_regions' => [$message]]);
        }

        $media->forceFill([
            'blur_regions' => PlateBlurChoice::normalise($regions),
            'status' => MediaStatus::Processing,
            'plate_blur' => PlateBlurState::Blurred,
        ])->save();
        $this->media->withdraw($media);

        // The build's OG image and share cards may show a vehicle photo; a member's card shows their cover and avatar, and a cover may
        // be one of their vehicle photos (MemberCovers).
        if ($parent instanceof Vehicle || $parent instanceof Modification) {
            $this->og->purge($parent instanceof Modification ? $parent->vehicle : $parent);
        }

        $owner = User::query()->find($media->owner_id);

        if ($owner instanceof User && ($parent instanceof User || $owner->getAttribute('cover_media_id') === $media->getKey())) {
            $this->og->purge($owner);
        }

        // SEC-P5G-09: the member's cached Wrapped cards may show the photo unpixelated.
        app(WrappedCardImages::class)->forgetMember($media->owner_id);

        // Last: a sync queue (tests, a host without the cron worker) runs the job right here, after the old files are gone.
        BlurMedia::dispatch((string) $media->getKey());

        return $media->refresh();
    }
}
