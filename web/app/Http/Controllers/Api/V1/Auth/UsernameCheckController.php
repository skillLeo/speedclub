<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\CheckUsernameRequest;
use App\Http\Resources\V1\UsernameAvailabilityResource;
use App\Models\User;
use App\Services\Auth\UsernameAvailability;

class UsernameCheckController extends Controller
{
    /**
     * Check whether a username can be used.
     *
     * Case-insensitive. `reason` is null when it is available. The caller's own username counts as available when the
     * request carries their auth.
     *
     * @unauthenticated
     */
    public function __invoke(CheckUsernameRequest $request, UsernameAvailability $availability): UsernameAvailabilityResource
    {
        $username = $request->string('username')->toString();
        $member = $request->user('sanctum');

        return new UsernameAvailabilityResource([
            'username' => $username,
            'reason' => $availability->reason($username, $member instanceof User ? $member : null),
        ]);
    }
}
