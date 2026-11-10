<?php

namespace App\Http\Controllers\Api\V1\Media;

use App\Actions\Media\BlurPhoto;
use App\Actions\Media\DeleteMedia;
use App\Actions\Media\ReorderVehicleMedia;
use App\Actions\Media\UpdateMedia;
use App\Actions\Media\UploadVehicleMedia;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Media\ReorderMediaRequest;
use App\Http\Requests\Api\V1\Media\StoreVehicleMediaRequest;
use App\Http\Requests\Api\V1\Media\UpdateMediaRequest;
use App\Http\Resources\V1\MediaResource;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

class MediaController extends Controller
{
    /**
     * Upload a vehicle photo.
     *
     * Multipart. Accepts an Idempotency-Key header. Up to 15 MB, JPEG, PNG or WebP by content (413, 415);
     * HEIC is converted by the client first. Status is `processing` when the server retries in the background.
     */
    public function store(StoreVehicleMediaRequest $request, Vehicle $vehicle, UploadVehicleMedia $action): MediaResource
    {
        Gate::authorize('update', $vehicle);
        Gate::authorize('create', Media::class);

        /** @var User $user */
        $user = $request->user();
        $attributes = $request->safe()->except('file');

        /** @var UploadedFile $file */
        $file = $request->file('file');

        /** @status 201 */
        return new MediaResource($action->handle($user, $vehicle, $file, $attributes));
    }

    /**
     * Update alt text, focal point or category, or pixelate plates and faces.
     *
     * [SIG] `blur_regions` (404 `feature_disabled` while `sig.plate_blur` is off): up to 10 rectangles, normalised 0–1. The answer is the
     * photo in `processing`, without variants: the queue pixelates every variant and the original, which is replaced, and the photo comes
     * back `ready` under new URLs. 422 for a photo that is not finished.
     */
    public function update(UpdateMediaRequest $request, Media $media, UpdateMedia $action, BlurPhoto $blur): MediaResource
    {
        Gate::authorize('update', $media);

        /** @var array<string, mixed> $attributes */
        $attributes = $request->safe()->except('blur_regions');
        $media = $attributes === [] ? $media : $action->handle($media, $attributes);

        if ($request->has('blur_regions')) {
            /** @var list<array{x: float|int|string, y: float|int|string, w: float|int|string, h: float|int|string}> $regions */
            $regions = $request->validated('blur_regions');
            $media = $blur->handle($media, $regions);
        }

        return new MediaResource($media);
    }

    /**
     * Reorder a vehicle's photos.
     *
     * `ids` must hold every entry of `photos` exactly once. A failed upload (`failed_photos`) is not part of the order.
     */
    public function reorder(ReorderMediaRequest $request, Vehicle $vehicle, ReorderVehicleMedia $action): AnonymousResourceCollection
    {
        Gate::authorize('update', $vehicle);

        /** @var list<string> $ids */
        $ids = $request->validated('ids');

        return MediaResource::collection($action->handle($vehicle, $ids));
    }

    /**
     * Delete a photo.
     *
     * Soft delete. A vehicle cover moves to the next finished photo. Also how the owner clears a failed upload.
     */
    public function destroy(Media $media, DeleteMedia $action): Response
    {
        Gate::authorize('delete', $media);

        $action->handle($media);

        return response()->noContent();
    }
}
