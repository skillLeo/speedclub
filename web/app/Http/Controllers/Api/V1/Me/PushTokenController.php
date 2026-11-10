<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Notifications\RegisterPushToken;
use App\Actions\Notifications\RemovePushToken;
use App\Enums\DevicePlatform;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\RemovePushTokenRequest;
use App\Http\Requests\Api\V1\Me\StorePushTokenRequest;
use App\Models\PushToken;
use App\Models\User;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * AUTH-10 and sign-out: the Expo push token of this install (05_ARCHITECTURE §11).
 */
class PushTokenController extends Controller
{
    /**
     * Register this install's push token.
     *
     * Upsert per `device_id`: calling it again, or with a new token of the same install, leaves one row. Answers 204.
     */
    public function store(StorePushTokenRequest $request, RegisterPushToken $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('create', PushToken::class);

        /** @var array{token: string, platform: string, device_id: string} $data */
        $data = $request->validated();
        $action->handle($user, $data['token'], DevicePlatform::from($data['platform']), $data['device_id']);

        return response()->noContent();
    }

    /**
     * Remove this install's push token.
     *
     * Answers 204, also when the install had none.
     */
    public function destroy(RemovePushTokenRequest $request, RemovePushToken $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('deleteOwn', PushToken::class);

        $action->handle($user, $request->deviceId());

        return response()->noContent();
    }
}
