<?php

namespace App\Http\Controllers\Api\V1\Garage;

use App\Actions\Garage\AddBuildNote;
use App\Actions\Garage\SetBuildUpdateHidden;
use App\Enums\ErrorCode;
use App\Enums\RestrictionType;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Garage\BuildUpdateListRequest;
use App\Http\Requests\Api\V1\Garage\StoreBuildUpdateRequest;
use App\Http\Requests\Api\V1\Garage\UpdateBuildUpdateRequest;
use App\Http\Resources\V1\BuildUpdateResource;
use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Moderation\ModerationHolds;
use App\Support\Viewer;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * GAR-11. Automatic entries come from the changes themselves (App\Services\Garage\BuildUpdates).
 */
class BuildUpdateController extends Controller
{
    /**
     * List a vehicle's build updates.
     *
     * Newest first. Hidden entries for the owner only.
     */
    public function index(BuildUpdateListRequest $request, Vehicle $vehicle): AnonymousResourceCollection
    {
        abort_unless(Gate::allows('view', $vehicle), 404);

        $updates = $vehicle->buildUpdates();
        // M4.11: hidden entries for the owner only, followers-only posts for followers (BuildUpdate::restrictTo).
        BuildUpdate::restrictTo($updates->getQuery(), Viewer::from($request), $vehicle);

        return BuildUpdateResource::collection(
            $updates
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * Write a note.
     *
     * Accepts an Idempotency-Key header. Up to 500 characters; never merged with automatic entries. A draft has no history yet: 403.
     */
    public function store(StoreBuildUpdateRequest $request, Vehicle $vehicle, AddBuildNote $action): BuildUpdateResource
    {
        Gate::authorize('create', [BuildUpdate::class, $vehicle]);

        /** @status 201 */
        return new BuildUpdateResource($action->handle($vehicle, $request->string('note')->toString())->refresh());
    }

    /**
     * Hide an entry or show it again.
     *
     * A hidden entry stays for the owner and never shows publicly. Hiding stays open under a publishing restriction; showing
     * again answers 403 `account_restricted`, since it makes something public.
     */
    public function update(UpdateBuildUpdateRequest $request, BuildUpdate $update, SetBuildUpdateHidden $action, ModerationHolds $holds): BuildUpdateResource
    {
        Gate::authorize('update', $update);

        $hidden = $request->boolean('hidden');
        /** @var User $user */
        $user = $request->user();

        if (! $hidden && $user->isRestrictedFrom(RestrictionType::Publishing)) {
            throw ApiException::accountRestricted($user->restrictedUntil(RestrictionType::Publishing));
        }

        // M2.6: an entry moderation removed (remove_content) stays hidden until an appeal reverses it.
        if (! $hidden && $holds->holds($update)) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        return new BuildUpdateResource($action->handle($update, $hidden));
    }
}
