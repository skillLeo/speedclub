<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Notifications\RegisterPushSubscription;
use App\Actions\Notifications\RemovePushSubscription;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\RemovePushSubscriptionRequest;
use App\Http\Requests\Api\V1\Me\StorePushSubscriptionRequest;
use App\Models\PushSubscription;
use App\Models\User;
use App\Services\Auth\DeviceSessions;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * SET-09 on the member web (09 §8.13, ADR-452): this browser's Web Push subscription.
 */
class PushSubscriptionController extends Controller
{
    /**
     * Register this browser's Web Push subscription.
     *
     * Upsert per `endpoint`: calling it again leaves one row, and an endpoint another member registered before moves to you. Only
     * endpoints of the browsers' push services are accepted. 404 `feature_disabled` while the flag `web_push` is off. Answers 204.
     */
    public function store(StorePushSubscriptionRequest $request, RegisterPushSubscription $action, DeviceSessions $sessions): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('create', PushSubscription::class);

        /** @var array{endpoint: string, keys: array{p256dh: string, auth: string}, user_agent?: string|null} $data */
        $data = $request->validated();
        $action->handle($user, $data['endpoint'], $data['keys']['p256dh'], $data['keys']['auth'], $data['user_agent'] ?? null, $sessions->currentSessionId($user, $request));

        return response()->noContent();
    }

    /**
     * Remove this browser's Web Push subscription.
     *
     * Answers 204, also when the server has no such subscription of yours. Open while the flag is off, so a browser can always clean up.
     */
    public function destroy(RemovePushSubscriptionRequest $request, RemovePushSubscription $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('deleteOwn', PushSubscription::class);

        /** @var array{endpoint: string} $data */
        $data = $request->validated();
        $action->handle($user, $data['endpoint']);

        return response()->noContent();
    }
}
