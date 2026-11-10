<?php

namespace App\Actions\Media;

use App\Enums\ErrorCode;
use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdates;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use App\Services\Rules\ContentScreen;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

class UploadVehicleMedia
{
    public function __construct(
        private readonly MediaService $media,
        private readonly BuildUpdates $updates,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
        private readonly ContentScreen $screen,
    ) {}

    /**
     * The photo limit is checked under a row lock on the vehicle, while reserving the row. The image work runs after
     * the commit, so no lock is held for those seconds and parallel uploads cannot overshoot the limit.
     *
     * The member's lock comes first, as in every other action: the insert into media takes a shared lock on the member's row through
     * media.owner_id, so with the vehicle first this would deadlock against PublishVehicle, SetMainVehicle and DeleteVehicle.
     *
     * @param  array{alt?: string|null, focal_x?: float|null, focal_y?: float|null, category?: MediaCategory|string|null}  $attributes
     */
    public function handle(User $user, Vehicle $vehicle, UploadedFile $file, array $attributes): Media
    {
        $bytes = $this->media->inspectUpload($file);
        // SEC-P3-15: the caption, before anything is stored.
        $flags = $this->screen->screen(UpdateMedia::screened($attributes));

        $reserved = DB::transaction(function () use ($user, $vehicle, $attributes, $bytes): Media {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            $locked = Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();
            $photos = $locked->media()->where('status', '!=', MediaStatus::Failed);
            $limit = config()->integer('speedclub.garage.max_photos_per_vehicle');

            if ($photos->count() >= $limit) {
                $message = (string) __('media.limit_reached', ['max' => $limit]);

                throw new ApiException(ErrorCode::ValidationFailed, errors: ['file' => [$message]]);
            }

            $sort = $locked->media()->max('sort');

            return $this->media->reserve($user, $locked, [
                ...$attributes,
                'sort' => is_numeric($sort) ? (int) $sort + 1 : 0,
            ], strlen($bytes));
        });

        $media = $this->media->processOrQueue($reserved, $bytes);

        // A photo still waiting for the queue is on no page yet; ProcessMedia does all three when it gets there.
        // A photo deleted while it was processed in this request never became visible either.
        if ($media->status === MediaStatus::Ready && Media::query()->whereKey($media->getKey())->exists()) {
            $this->updates->photoAdded($vehicle);
            $this->search->changed($vehicle);
            $this->og->queue($vehicle);
        }

        $this->screen->flagAfterCommit($flags, $vehicle);

        return $media;
    }
}
