<?php

namespace App\Actions\Notifications;

use App\Models\PushSubscription;
use App\Models\User;

/**
 * M4.15 (ADR-452): this browser's subscription, if it is the member's. Another member's endpoint is left alone, and an unknown one is
 * no error (the client calls this at sign-out whatever the server has).
 */
class RemovePushSubscription
{
    public function handle(User $user, string $endpoint): void
    {
        PushSubscription::query()
            ->where('user_id', $user->id)
            ->where('endpoint_hash', PushSubscription::hashEndpoint($endpoint))
            ->delete();
    }
}
