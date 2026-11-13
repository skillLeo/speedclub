<?php

namespace App\Services\Auth;

use App\Models\DeviceInstall;
use App\Models\User;
use App\Services\Security\ApproximatePlace;
use App\Support\Auth\DeviceInfo;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;

/**
 * device_installs (09 §8.4): what an app install says about itself at sign-in and rotation. Without an install id (older app builds)
 * there is no row; SET-06 then shows what the token knows.
 */
final class DeviceInstalls
{
    public function __construct(
        private readonly ApproximatePlace $places,
        private readonly Request $request,
    ) {}

    /**
     * SEC-M47-03: the only form an install id is stored in (device_installs.install_id_hash, personal_access_tokens.device_id,
     * push_tokens.device_id): keyed with the app key and the member, so the stored value says nothing without the key and two members'
     * rows of one shared phone share no value. DeviceInfo::keyedFor() turns a sign-in's id into it before anything is written.
     */
    public static function key(string $userId, string $installId): string
    {
        return hash_hmac('sha256', 'install|'.$userId.'|'.mb_strtolower($installId), config()->string('app.key'));
    }

    /**
     * push_tokens.install_key: the install without the member, so a sign-in on a phone can end the previous member's push token there
     * (M2.2 review #5). One install has at most one push token row at any time (IssueDeviceToken, RegisterPushToken), so this value never
     * stands in two accounts' rows at once.
     */
    public static function installKey(string $installId): string
    {
        return hash_hmac('sha256', 'install-key|'.mb_strtolower($installId), config()->string('app.key'));
    }

    /**
     * The hash of 532bb10 (app key only), for the data migration that rekeys existing rows.
     */
    public static function legacyHash(string $installId): string
    {
        return hash_hmac('sha256', 'install|'.mb_strtolower($installId), config()->string('app.key'));
    }

    /**
     * known_devices.fingerprint of an app install, as DeviceInfo::fingerprint() computes it from the keyed id.
     */
    public static function fingerprint(string $userId, string $installId): string
    {
        return hash('sha256', 'token-id|'.self::key($userId, $installId));
    }

    /**
     * $keyedId as DeviceInfo::keyedFor() made it.
     */
    public function find(User $user, string $keyedId): ?DeviceInstall
    {
        return $user->deviceInstalls()->where('install_id_hash', $keyedId)->first();
    }

    /**
     * Creates or refreshes the member's row of this install ($device keyed, DeviceInfo::keyedFor()). Fields the app did not send keep their
     * last value.
     */
    public function record(User $user, DeviceInfo $device): ?DeviceInstall
    {
        if ($device->id === null) {
            return null;
        }

        $values = array_filter([
            'platform' => $device->platform,
            'model' => mb_substr($device->name, 0, 120),
            'os_version' => $device->osVersion,
            'app_version' => $device->appVersion,
            'approx_city' => $this->places->city($this->request->ip()),
        ], fn (mixed $value): bool => $value !== null);

        $install = $this->find($user, $device->id);

        if ($install === null) {
            try {
                $install = new DeviceInstall([...$values, 'first_seen_at' => now(), 'last_seen_at' => now()]);
                $install->forceFill(['user_id' => $user->getKey(), 'install_id_hash' => $device->id])->save();

                return $install;
            } catch (UniqueConstraintViolationException) {
                // Two sign-ins of one install at once: the other one wrote the row.
                $install = $this->find($user, $device->id);

                if ($install === null) {
                    return null;
                }
            }
        }

        $install->fill([...$values, 'last_seen_at' => now()])->save();

        return $install;
    }
}
