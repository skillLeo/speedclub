<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Same order as UploadVehicleMedia: the member's lock first, then the vehicle's, then the modification's (as SaveModification and
 * DeleteModification take them), the limit of 6 checked under a lock while reserving, the image work after the commit. The vehicle
 * is read under its soft-delete scope: a delete that committed while this waited answers 404, as a gallery upload does, instead of
 * a public photo on a deleted vehicle (ADR-123). A mod photo never becomes the vehicle's cover.
 */
class UploadModificationMedia
{
    public function __construct(
        private readonly MediaService $media,
        private readonly VehicleSearchProjector $search,
    ) {}

    /**
     * @param  array{alt?: string|null, focal_x?: float|null, focal_y?: float|null, category?: string|null}  $attributes  validated
     */
    public function handle(User $user, Modification $mod, UploadedFile $file, array $attributes): Media
    {
        $bytes = $this->media->inspectUpload($file);

        $reserved = DB::transaction(function () use ($user, $mod, $attributes, $bytes): Media {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            Vehicle::query()->whereKey($mod->vehicle_id)->lockForUpdate()->firstOrFail();
            $locked = Modification::query()->whereKey($mod->getKey())->lockForUpdate()->firstOrFail();
            $limit = config()->integer('speedclub.garage.max_photos_per_modification');

            if ($locked->media()->where('status', '!=', MediaStatus::Failed)->count() >= $limit) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['file' => [(string) __('garage.mod_photo_limit_reached', ['max' => $limit])]]);
            }

            $sort = $locked->media()->max('sort');

            return $this->media->reserve($user, $locked, [...$attributes, 'sort' => is_numeric($sort) ? (int) $sort + 1 : 0], strlen($bytes));
        });

        $media = $this->media->processOrQueue($reserved, $bytes);

        // A photo still waiting for the queue is on no page yet; ProcessMedia stamps the build when it gets there.
        // A photo deleted while it was processed in this request never became visible either.
        if ($media->status === MediaStatus::Ready && Media::query()->whereKey($media->getKey())->exists()) {
            $this->search->changed($mod->vehicle);
        }

        return $media;
    }
}
