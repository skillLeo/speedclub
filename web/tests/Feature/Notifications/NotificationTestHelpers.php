<?php

use App\Models\BuildUpdate;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\Http;

require_once __DIR__.'/../Social/SocialTestHelpers.php';

/**
 * M2.2 notification test helpers, prefixed ntf… so they never collide with another file's functions.
 */
function ntfMember(string $username, array $attributes = []): User
{
    return User::factory()->create(['username' => $username, ...$attributes]);
}

/**
 * Push on, with a token for $member, and Expo answered by Http::fake (never the network).
 */
function ntfPushOn(?User $member = null): void
{
    config(['speedclub.push.enabled' => true]);
    Http::preventStrayRequests();
    Http::fake([
        'exp.host/--/api/v2/push/send' => Http::response(['data' => [['status' => 'ok', 'id' => 'ticket-1']]]),
        'exp.host/--/api/v2/push/getReceipts' => Http::response(['data' => []]),
    ]);

    if ($member !== null) {
        PushToken::factory()->create(['user_id' => $member->id, 'token' => 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]', 'device_id' => 'install-1']);
    }
}

/**
 * The requests that went to push/send.
 *
 * @return list<array<int, array<string, mixed>>>
 */
function ntfPushes(): array
{
    return array_values(array_map(
        fn (array $pair): array => $pair[0]->data(),
        Http::recorded(fn ($request) => str_contains($request->url(), 'push/send'))->all(),
    ));
}

function ntfRows(User $recipient): int
{
    return Notification::query()->where('notifiable_id', $recipient->id)->count();
}

/**
 * A visible build update of a published public build.
 */
function ntfUpdate(Vehicle $vehicle, ?string $at = null, bool $hidden = false): BuildUpdate
{
    $update = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'hidden' => $hidden]);
    $update->forceFill(['created_at' => $at ?? now()])->save();

    return $update;
}
