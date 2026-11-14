<?php

namespace App\Actions\Notifications;

use App\Models\PushSubscription;
use App\Models\User;
use App\Services\Auth\DeviceSessions;
use Illuminate\Support\Facades\DB;

/**
 * M4.15 (ADR-452): one row per browser endpoint. Idempotent: the same subscription twice leaves one row. An endpoint that last
 * belonged to another member now belongs to this one (whoever turned notifications on in a browser last gets them there), with fresh
 * keys and no failures. The subscription is tied to the sign-in that made it: the member web session (session_key) or, for a request
 * with an app token, that token (token_id, SEC-P4-01), so ending that browser or device in SET-06 ends its notifications too. Of the user agent only the browser and system names are kept. A member keeps the newest speedclub.web_push.max_per_member browsers; older ones go.
 */
class RegisterPushSubscription
{
    /**
     * @param  string|null  $sessionId  the member web session of the request (DeviceSessions::currentSessionId); null for a token
     * @param  int|null  $tokenId  the app token of the request (DeviceSessions::currentTokenId); null for a member web session
     */
    public function handle(User $user, string $endpoint, string $publicKey, string $authToken, ?string $userAgent, ?string $sessionId = null, ?int $tokenId = null): PushSubscription
    {
        return DB::transaction(function () use ($user, $endpoint, $publicKey, $authToken, $userAgent, $sessionId, $tokenId): PushSubscription {
            $hash = PushSubscription::hashEndpoint($endpoint);
            $row = PushSubscription::query()->where('endpoint_hash', $hash)->lockForUpdate()->first() ?? new PushSubscription;

            $row->forceFill([
                'user_id' => $user->id,
                'endpoint_hash' => $hash,
                'endpoint' => $endpoint,
                'public_key' => $publicKey,
                'auth_token' => $authToken,
                'content_encoding' => 'aes128gcm',
                'browser' => self::browser($userAgent),
                'session_key' => $sessionId === null ? null : PushSubscription::sessionKey($sessionId),
                'token_id' => $sessionId === null ? $tokenId : null,
                'failures' => 0,
            ]);
            // A repeat with nothing new still counts as this browser's latest sign of life, for the per-member limit below.
            $row->exists && ! $row->isDirty() ? $row->touch() : $row->save();

            $keep = PushSubscription::query()->where('user_id', $user->id)
                ->orderByDesc('updated_at')->orderByDesc('id')
                ->limit(max(1, config()->integer('speedclub.web_push.max_per_member')))
                ->pluck('id');

            PushSubscription::query()->where('user_id', $user->id)->whereNotIn('id', $keep)->delete();

            return $row;
        });
    }

    /**
     * "Chrome, macOS": enough for the member to recognise the browser in the data export. The user agent itself is not stored.
     */
    private static function browser(?string $userAgent): ?string
    {
        [$browser, $os] = DeviceSessions::browserParts((string) $userAgent);

        return $browser === null ? null : mb_substr($os === null ? $browser : $browser.', '.$os, 0, 40);
    }
}
