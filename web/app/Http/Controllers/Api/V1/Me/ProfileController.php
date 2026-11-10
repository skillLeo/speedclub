<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\ChangeUsername;
use App\Actions\Me\UpdateProfile;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\UpdateProfileRequest;
use App\Http\Requests\Api\V1\Me\UpdateUsernameRequest;
use App\Http\Resources\V1\MeResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class ProfileController extends Controller
{
    /**
     * My profile.
     */
    public function show(Request $request): MeResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('view', $user);

        return new MeResource($user);
    }

    /**
     * Update name, city or bio.
     *
     * Any call ends the profile step of onboarding, so an empty body is how the app skips it.
     */
    public function update(UpdateProfileRequest $request, UpdateProfile $action): MeResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('updateProfile', $user);

        return new MeResource($action->handle($user, $request->validated()));
    }

    /**
     * Choose or change the username.
     *
     * The first choice is free; a change after it waits 30 days: 409 `username_change_cooldown` with `until`. Old names
     * stay blocked for others for 14 days.
     */
    public function username(UpdateUsernameRequest $request, ChangeUsername $action): MeResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('updateProfile', $user);

        return new MeResource($action->handle($user, $request->string('username')->toString()));
    }
}
