<?php

namespace App\Http\Resources\V1;

use App\Enums\DevicePlatform;
use App\Enums\SecurityActivity;
use App\Enums\SignInMethod;
use App\Models\PersonalAccessToken;
use App\Models\SecurityEvent;
use App\Models\User;
use App\Services\Auth\Passkeys\PasskeyProviders;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of SET-21 Sicherheitsaktivität (09 §7.9, §8.4). Never an IP address; a place only as the approximate city (OA-33).
 *
 * @property SecurityEvent $resource
 */
class SecurityEventResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $event = $this->resource;
        $activity = $event->activity() ?? SecurityActivity::SignedIn;
        $meta = $event->meta ?? [];
        $viewer = $request->user();
        $token = $viewer instanceof User ? $viewer->currentAccessToken() : null;
        $thisInstall = $token instanceof PersonalAccessToken ? $token->getAttribute('device_install_id') : null;
        $passkey = is_string($meta['aaguid'] ?? null) ? PasskeyProviders::for($meta['aaguid'], app()->getLocale()) : null;
        $steps = is_array($meta['steps'] ?? null) ? $meta['steps'] : null;

        return [
            'id' => $event->id,
            /** @var SecurityActivity */
            'type' => $activity,
            /** ISO 8601. For `sign_in_failed`, the first failure of that day; `details.last_at` is the latest. */
            'occurred_at' => $event->created_at->toIso8601String(),
            /** @var array{name: string|null, platform: DevicePlatform|null}|null The device it happened on, when known; null for a staff action. */
            'device' => $event->device_name === null && $event->platform === null ? null : [
                'name' => $event->device_name,
                'platform' => $event->platform,
            ],
            /** The app install of this request. */
            'this_device' => $thisInstall !== null && $thisInstall === $event->device_install_id,
            /** @var string|null "München": approximate, only with a GeoLite2 database (OA-33). */
            'approx_city' => $event->approx_city,
            /** @var SignInMethod|null How the member signed in (sign-in rows). */
            'method' => SignInMethod::tryFrom(is_string($meta['method'] ?? null) ? $meta['method'] : ''),
            /** Done by the SPEED CLUB team (e.g. sessions ended by support). */
            'by_staff' => ($meta['by_staff'] ?? false) === true,
            /**
             * What else the row names: `provider` (apple, google), `passkey_provider` (iCloud-Schlüsselbund, …), `count` and `steps`
             * {password, email_code, second_factor} of failed attempts with `last_at`, `devices` and `sessions` signed out, `recovery_codes_left`.
             *
             * @var array{provider?: string, passkey_provider?: string, count?: int, steps?: array<string, int>, last_at?: string, devices?: int, sessions?: int, recovery_codes_left?: int}
             */
            'details' => (object) array_filter([
                'provider' => is_string($meta['provider'] ?? null) ? $meta['provider'] : null,
                'passkey_provider' => $passkey['name'] ?? null,
                'count' => is_int($meta['count'] ?? null) ? $meta['count'] : null,
                'steps' => $steps,
                'last_at' => is_string($meta['last_at'] ?? null) ? $meta['last_at'] : null,
                'devices' => is_int($meta['devices'] ?? null) ? $meta['devices'] : null,
                'sessions' => is_int($meta['sessions'] ?? null) ? $meta['sessions'] : null,
                'recovery_codes_left' => is_int($meta['left'] ?? null) ? $meta['left'] : null,
            ], fn (mixed $value): bool => $value !== null),
            /** Offers "Das war ich nicht" (POST me/security/secure with this id). */
            'can_secure' => $activity->securable(),
        ];
    }
}
