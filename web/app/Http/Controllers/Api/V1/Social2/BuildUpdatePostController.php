<?php

namespace App\Http\Controllers\Api\V1\Social2;

use App\Actions\Social\Updates\DeleteBuildUpdate;
use App\Actions\Social\Updates\EditBuildUpdate;
use App\Actions\Social\Updates\PostBuildUpdate;
use App\Actions\Social\Updates\UploadBuildUpdatePhoto;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social2\StoreBuildUpdatePhotoRequest;
use App\Http\Requests\Api\V1\Social2\StoreBuildUpdatePostRequest;
use App\Http\Requests\Api\V1\Social2\UpdateBuildUpdatePostRequest;
use App\Http\Resources\V1\BuildUpdateResource;
use App\Http\Resources\V1\MediaResource;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * Build updates 2.0 (09 §8.5, UPD-01, VEH-05): an owner's post with text, @mentions, photos (before/after pairs), linked mods, mileage,
 * date and audience; editable for 24 hours, deletable any time. Lists stay on vehicles/{id}/updates and public/vehicles/{slug}/updates.
 */
class BuildUpdatePostController extends Controller
{
    /**
     * Post a build update.
     *
     * Accepts an Idempotency-Key header. The photos follow with POST build-updates/{id}/media (up to 10). Followers of the owner and of the
     * build hear about it once it has text, a photo or a linked mod; mentioned members at once (mentions flag). A draft vehicle: 403.
     * Unknown or foreign vehicle: 404 vehicle_unavailable.
     */
    public function store(StoreBuildUpdatePostRequest $request, PostBuildUpdate $action): BuildUpdateResource
    {
        /** @var User $user */
        $user = $request->user();
        $vehicle = Vehicle::query()->find($request->string('vehicle_id')->lower()->toString());

        if (! $vehicle instanceof Vehicle || ! Gate::allows('view', $vehicle)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        Gate::authorize('create', [BuildUpdate::class, $vehicle]);

        /** @var array{text?: string|null, mileage_km?: int|null, happened_on?: string|null, audience?: string|null, modification_ids?: list<string>|null} $data */
        $data = $request->safe()->except('vehicle_id');

        /** @status 201 */
        return (new BuildUpdateResource($action->handle($user, $vehicle, $data)->refresh()))->complete();
    }

    /**
     * Read a build update (VEH-05).
     *
     * Guests too. Hidden entries, followers-only posts for non-followers and anything of a vehicle the viewer may not see: 404.
     *
     * @unauthenticated
     */
    public function show(Request $request, BuildUpdate $update): BuildUpdateResource
    {
        if (! Gate::forUser(Viewer::from($request))->allows('view', $update)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return (new BuildUpdateResource($update))->complete();
    }

    /**
     * Edit a build update.
     *
     * The owner's posts and notes, within 24 hours of posting (403 edit_window_closed afterwards; hiding stays on PATCH updates/{id}).
     * Any subset of text, mileage_km, happened_on, audience, modification_ids, photo_order and photo_pairs; a change stamps edited_at.
     */
    public function update(UpdateBuildUpdatePostRequest $request, BuildUpdate $update, EditBuildUpdate $action): BuildUpdateResource
    {
        Gate::authorize('edit', $update);

        /** @var User $user */
        $user = $request->user();

        return (new BuildUpdateResource($action->handle($update, $user, $request->validated())))->complete();
    }

    /**
     * Delete a build update.
     *
     * The owner's posts and notes, any time and also under a restriction. Photos, reactions, mentions, comments, highlights and
     * collection entries go with it. Answers 204.
     */
    public function destroy(BuildUpdate $update, DeleteBuildUpdate $action): Response
    {
        Gate::authorize('delete', $update);

        $action->handle($update);

        return response()->noContent();
    }

    /**
     * Add a photo to a build update.
     *
     * Multipart, as a gallery upload (up to 15 MB, JPEG, PNG or WebP by content; re-encoded, EXIF stripped). Up to 10 per update, within
     * the 24-hour edit window. Accepts an Idempotency-Key header.
     */
    public function storePhoto(StoreBuildUpdatePhotoRequest $request, BuildUpdate $update, UploadBuildUpdatePhoto $action): MediaResource
    {
        Gate::authorize('edit', $update);
        Gate::authorize('create', Media::class);

        /** @var User $user */
        $user = $request->user();
        /** @var UploadedFile $file */
        $file = $request->file('file');
        /** @var array{alt?: string|null, focal_x?: float|null, focal_y?: float|null} $attributes */
        $attributes = $request->safe()->except('file');

        /** @status 201 */
        return new MediaResource($action->handle($user, $update, $file, $attributes));
    }
}
