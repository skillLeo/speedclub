<?php

namespace App\Actions\Media;

use App\Enums\MediaStatus;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

/**
 * Soft delete. The public files go at once (SEC-101), the private original with the 30-day hard delete (media:prune).
 * Nothing may keep pointing at a deleted photo: a vehicle's cover moves to its next usable photo, a member's avatar or
 * cover image is cleared. Deleting a vehicle or an account goes through DeleteAllMedia.
 *
 * A failed row was never on a page or a card, so clearing it is housekeeping: no new time on the build, no new share card (BH-44, BH-46).
 * A row still processing was on no page either and gets no new time; the upload or ProcessMedia stamps the build when a photo turns
 * ready. It keeps the share-card purge in withdraw(), though: the queue may have finished it and drawn it into the card meanwhile.
 */
class DeleteMedia
{
    public function __construct(
        private readonly MediaService $service,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
    ) {}

    public function handle(Media $media): void
    {
        $this->softDelete($media);
        $this->withdraw($media);
    }

    /**
     * The database half, for callers that need it in their own transaction. Call withdraw() after that has committed:
     * a rollback can bring the row back, but not files.
     */
    public function softDelete(Media $media): void
    {
        DB::transaction(function () use ($media): void {
            $vehicle = $media->getAttribute('mediable_type') === (new Vehicle)->getMorphClass()
                ? Vehicle::withTrashed()->whereKey($media->getAttribute('mediable_id'))->lockForUpdate()->first()
                : null;

            $media->delete();

            if ($vehicle !== null && $vehicle->getAttribute('cover_media_id') === $media->getKey()) {
                $vehicle->forceFill(['cover_media_id' => $vehicle->media()
                    ->usablePhoto()
                    ->orderBy('sort')
                    ->orderBy('id')
                    ->value('id')])->save();
            }

            $parent = $vehicle ?? $this->vehicleOfModification($media);

            if ($parent !== null && $this->wasVisible($media)) {
                $this->search->changed($parent);
            }

            User::query()->where('avatar_media_id', $media->getKey())->update(['avatar_media_id' => null]);
            User::query()->where('cover_media_id', $media->getKey())->update(['cover_media_id' => null]);
        });
    }

    /**
     * The OG image may hold this very photo, and a deleted photo is gone at once (ADR-123). The queue draws it again from what is left.
     */
    public function withdraw(Media $media): void
    {
        $this->service->withdraw($media);

        if ($media->status === MediaStatus::Failed) {
            return;
        }

        $subject = match ($media->getAttribute('mediable_type')) {
            (new Vehicle)->getMorphClass() => Vehicle::withTrashed()->find($media->getAttribute('mediable_id')),
            (new User)->getMorphClass() => User::withTrashed()->find($media->getAttribute('mediable_id')),
            default => null,
        };

        if ($subject instanceof Vehicle || $subject instanceof User) {
            $this->og->purge($subject);
            $this->og->queue($subject);
        }
    }

    /**
     * Read again rather than from the route's copy: a row the queue finished after the route read it was on the page, and deleting
     * it is a change of the build. Under the vehicle's lock taken above for a gallery photo; ProcessMedia writes the status without it,
     * so a row it finishes after this read was stamped by ProcessMedia itself.
     */
    private function wasVisible(Media $media): bool
    {
        $status = Media::withTrashed()->whereKey($media->getKey())->value('status');

        return ($status instanceof MediaStatus ? $status : MediaStatus::tryFrom((string) $status)) === MediaStatus::Ready;
    }

    /**
     * Null for anything else, and for a modification that is itself going: its delete counts as the change.
     */
    private function vehicleOfModification(Media $media): ?Vehicle
    {
        return $media->getAttribute('mediable_type') === (new Modification)->getMorphClass()
            ? Modification::query()->whereKey($media->getAttribute('mediable_id'))->first()?->vehicle
            : null;
    }
}
