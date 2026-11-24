<?php

namespace App\Actions\Media;

use App\Enums\PlateBlurState;
use App\Models\Media;
use App\Services\Wrapped\WrappedCardImages;

/**
 * M5.9a "Kein Kennzeichen sichtbar" in the plate check (m5.9a-contract §4): the photo stays exactly as it is and leaves the list as
 * `declined`. Conditional, so a parallel GAR-08 blur that set `blurred` first is never turned back.
 */
class KeepPlateCheckPhoto
{
    public function handle(Media $media): void
    {
        $changed = Media::query()->whereKey($media->getKey())
            ->where('plate_blur', PlateBlurState::Unchecked)
            ->update(['plate_blur' => PlateBlurState::Declined]);

        // SEC-P5G-09: a new plate decision can put the photo on a Wrapped card; cached cards are drawn again.
        if ($changed > 0) {
            app(WrappedCardImages::class)->forgetMember($media->owner_id);
        }
    }
}
