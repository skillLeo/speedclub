<?php

namespace App\Services\Security;

use App\Enums\DevicePlatform;
use App\Enums\MemberSecurityEvent;
use App\Models\DeviceInstall;
use App\Models\PersonalAccessToken;
use App\Models\SecurityEvent;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;

/**
 * member_security_events (09 §8.4): the member's own security log behind SET-21. Audit::record() writes a row here for every member
 * security event it records about a member, in the same transaction, so "every row is also audited" holds by construction. The device
 * is the one the audit payload names (a sign-in) or the token of the request; a staff action names none. Only a short list of payload
 * keys is kept, never a secret (the audit payload is already redacted) and never an IP address (ADR-113).
 */
final class SecurityEventLog
{
    /** Payload keys SET-21 may show. */
    private const META_KEYS = ['method', 'provider', 'passkey_id', 'aaguid', 'factor', 'left', 'devices', 'sessions', 'count', 'reason'];

    /**
     * @param  array<array-key, mixed>|null  $after  the cleaned audit payload
     */
    public static function capture(string $action, ?Model $target, ?array $after, ?Authenticatable $actor): void
    {
        $event = MemberSecurityEvent::tryFrom($action);

        // Failed sign-ins keep one row per day, counted by FailedSignIns itself.
        if ($event === null || $event === MemberSecurityEvent::SignInFailed || ! $target instanceof User || ! $target->exists) {
            return;
        }

        $after ??= [];
        $byStaff = $actor instanceof Staff;
        [$install, $name, $platform, $city] = $byStaff ? [null, null, null, null] : self::device($target, $after);

        $meta = array_intersect_key($after, array_flip(self::META_KEYS));

        if ($byStaff) {
            $meta['by_staff'] = true;
        }

        $row = new SecurityEvent([
            'type' => $event,
            'device_name' => $name === null ? null : mb_substr($name, 0, 120),
            'platform' => $platform,
            'approx_city' => $city,
            'meta' => $meta === [] ? null : $meta,
        ]);
        $row->forceFill(['user_id' => $target->getKey(), 'device_install_id' => $install?->id, 'created_at' => now()])->save();
    }

    /**
     * @param  array<array-key, mixed>  $after
     * @return array{0: DeviceInstall|null, 1: string|null, 2: DevicePlatform|null, 3: string|null}
     */
    private static function device(User $target, array $after): array
    {
        $installId = $after['device_install_id'] ?? null;
        $install = is_string($installId) ? DeviceInstall::query()->whereKey($installId)->where('user_id', $target->getKey())->first() : null;
        $name = is_string($after['device_name'] ?? null) ? $after['device_name'] : null;
        $platform = DevicePlatform::tryFrom(is_string($after['platform'] ?? null) ? $after['platform'] : '');

        if ($install !== null) {
            return [$install, $name ?? $install->model, $platform ?? $install->platform, $install->approx_city];
        }

        if ($name !== null) {
            return [null, $name, $platform, null];
        }

        // The request's own device, when it is the member's.
        $user = Auth::guard('sanctum')->user() ?? Auth::user();
        $token = $user instanceof User && $user->is($target) ? $user->currentAccessToken() : null;

        if ($token instanceof PersonalAccessToken && $token->exists) {
            $tokenPlatform = $token->getAttribute('platform');
            $city = $token->getAttribute('approx_city');
            $installKey = $token->getAttribute('device_install_id');

            return [
                is_string($installKey) ? DeviceInstall::query()->find($installKey) : null,
                $token->deviceName(),
                $tokenPlatform instanceof DevicePlatform ? $tokenPlatform : null,
                is_string($city) ? $city : null,
            ];
        }

        if ($user instanceof User && $user->is($target) && request()->hasSession()) {
            return [null, null, DevicePlatform::Web, null];
        }

        return [null, null, null, null];
    }
}
