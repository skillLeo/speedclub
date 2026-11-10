<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\RevokeDeviceSessions;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\DeviceSessionResource;
use App\Models\User;
use App\Services\Auth\DeviceSessions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class DeviceSessionController extends Controller
{
    /**
     * Devices and browsers signed in (SET-06).
     *
     * One row per app install and per browser session, this device first (`current`), then by last use. No IP address and no place.
     * A short list, not paged.
     */
    public function index(Request $request, DeviceSessions $sessions): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        return DeviceSessionResource::collection($sessions->list($user, $request));
    }

    /**
     * Sign out one device or browser (SET-06).
     *
     * Ends every token of that install and removes its push token. This device: 422 on `id` (use auth/logout). Unknown id: 404.
     */
    public function destroy(Request $request, string $session, RevokeDeviceSessions $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        $action->one($user, $session, $request);

        return response()->noContent();
    }

    /**
     * Sign out every other device and browser (SET-06).
     *
     * This device stays signed in. Push tokens of the other installs go too.
     */
    public function destroyOthers(Request $request, RevokeDeviceSessions $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        $action->others($user, $request);

        return response()->noContent();
    }
}
