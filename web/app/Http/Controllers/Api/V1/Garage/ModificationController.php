<?php

namespace App\Http\Controllers\Api\V1\Garage;

use App\Actions\Garage\DeleteModification;
use App\Actions\Garage\ReorderModifications;
use App\Actions\Garage\SaveModification;
use App\Actions\Garage\UploadModificationMedia;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Garage\GarageListRequest;
use App\Http\Requests\Api\V1\Garage\ModificationRequest;
use App\Http\Requests\Api\V1\Garage\ReorderModificationsRequest;
use App\Http\Requests\Api\V1\Media\StoreVehicleMediaRequest;
use App\Http\Resources\V1\MediaResource;
use App\Http\Resources\V1\ModificationResource;
use App\Http\Resources\V1\SavedModificationResource;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * GAR-09 and GAR-10 (02_PRODUCT_SPEC §3.3, FS-6).
 */
class ModificationController extends Controller
{
    private const RELATIONS = ['category.fields', 'brand.mergedInto', 'media', 'vehicle'];

    /**
     * List a vehicle's modifications.
     *
     * In the member's order. A vehicle the caller may not see does not exist for them.
     */
    public function index(GarageListRequest $request, Vehicle $vehicle): AnonymousResourceCollection
    {
        abort_unless(Gate::allows('view', $vehicle), 404);

        return ModificationResource::collection(
            $vehicle->modifications()
                ->with(self::RELATIONS)
                ->orderBy('sort')
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * Add a modification.
     *
     * Accepts an Idempotency-Key header. `fields` is checked against the schema of the category from catalog/mod-categories:
     * types, units, min, max, step, options, required; unknown keys answer 422 under `fields.<key>`. The title is brand + model
     * unless sent. On a published vehicle this feeds the open build update.
     */
    public function store(ModificationRequest $request, Vehicle $vehicle, SaveModification $action): ModificationResource
    {
        Gate::authorize('create', [Modification::class, $vehicle]);

        /** @var array<string, mixed> $attributes */
        $attributes = $request->safe()->except('category');
        $category = ModCategory::query()->with('fields')->where('key', $request->string('category')->toString())->firstOrFail();

        /** @status 201 */
        return new ModificationResource($action->add($vehicle, $category, $attributes)->refresh()->load(self::RELATIONS));
    }

    /**
     * Read a modification.
     *
     * The cost is null for anybody but the owner (never public); `fields` is the owner's.
     */
    public function show(Modification $modification): ModificationResource
    {
        abort_unless(Gate::allows('view', $modification), 404);

        return new ModificationResource($modification->load(self::RELATIONS));
    }

    /**
     * Update a modification.
     *
     * Only the keys sent change, `fields` as a whole. The category cannot change. `history_recorded` says whether Verlauf now
     * tells about this edit: false for what only the owner reads (notes, a private cost), for fields the history leaves out and
     * for a value changed back within 10 minutes, and always on a draft.
     */
    public function update(ModificationRequest $request, Modification $modification, SaveModification $action): SavedModificationResource
    {
        Gate::authorize('update', $modification);

        /** @var array<string, mixed> $attributes */
        $attributes = $request->validated();

        $saved = $action->change($modification->load('category.fields'), $attributes);

        return new SavedModificationResource($saved->modification->refresh()->load(self::RELATIONS), $saved->historyRecorded);
    }

    /**
     * Delete a modification.
     *
     * Soft delete; the build history keeps its entry. Stays open under a publishing restriction.
     */
    public function destroy(Modification $modification, DeleteModification $action): Response
    {
        Gate::authorize('delete', $modification);

        $action->handle($modification->load(['category', 'media']));

        return response()->noContent();
    }

    /**
     * Reorder a vehicle's modifications.
     *
     * `ids` must hold every modification of the vehicle exactly once.
     */
    public function reorder(ReorderModificationsRequest $request, Vehicle $vehicle, ReorderModifications $action): AnonymousResourceCollection
    {
        Gate::authorize('update', $vehicle);

        /** @var list<string> $ids */
        $ids = $request->validated('ids');

        return ModificationResource::collection($action->handle($vehicle, $ids)->load('vehicle'));
    }

    /**
     * Upload a photo of a modification.
     *
     * Multipart, like vehicle photos. Accepts an Idempotency-Key header. At most 6 per modification. Reorder is not offered;
     * delete through DELETE media/{id}.
     */
    public function uploadPhoto(StoreVehicleMediaRequest $request, Modification $modification, UploadModificationMedia $action): MediaResource
    {
        Gate::authorize('update', $modification);
        Gate::authorize('create', Media::class);

        /** @var User $user */
        $user = $request->user();
        /** @var array{alt?: string|null, focal_x?: float|null, focal_y?: float|null, category?: string|null} $attributes */
        $attributes = $request->safe()->except('file');

        /** @var UploadedFile $file */
        $file = $request->file('file');

        /** @status 201 */
        return new MediaResource($action->handle($user, $modification, $file, $attributes));
    }
}
