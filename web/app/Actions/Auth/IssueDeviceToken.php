<?php

namespace App\Actions\Auth;

use App\Models\PersonalAccessToken;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;
use App\Support\Auth\AuthResult;
use App\Support\Auth\DeviceInfo;
use Illuminate\Support\Facades\DB;

/**
 * One token per device: the old one of this device goes in the same step. A device is its per-install device_id when the app sent
 * one, so a second phone of the same model keeps its own token. Without it (older app builds) a device is its name and platform,
 * and that rule only reaches tokens that have no device_id either.
 */
class IssueDeviceToken
{
    public function __construct(private readonly DeviceInstalls $installs) {}

    /**
     * @param  bool  $secondFactor  the sign-in passed the second factor (SEC-M46-02: SecondFactorProof)
     */
    public function handle(User $user, DeviceInfo $device, bool $secondFactor = false): AuthResult
    {
        $device = $device->keyedFor($user);

        return DB::transaction(function () use ($user, $device, $secondFactor): AuthResult {
            $same = $user->tokens();

            if ($device->id !== null) {
                $same->where('device_id', $device->id);
                // The install now belongs to this member: the last member's push token there must not get this one's pushes, nor the
                // reverse (M2.2 review #5).
                if ($device->installKey !== null) {
                    PushToken::query()->where('install_key', $device->installKey)->where('user_id', '!=', $user->id)->delete();
                }
            } else {
                $same->whereNull('device_id')->where('device_name', $device->name)->where('platform', $device->platform);
            }

            $same->delete();

            // A sign-in is a fresh proof (09 §8.1 sudo mode), so AUTH-14 can add a passkey right after it.
            return $this->create($user, $device, signedInNow: true, secondFactor: $secondFactor);
        });
    }

    /**
     * Also used for rotation, which keeps the device data but not the sign-in moment: a rotated token is not a recent authentication.
     */
    public function create(User $user, DeviceInfo $device, bool $signedInNow = false, bool $secondFactor = false): AuthResult
    {
        $expires = now()->addDays(config()->integer('speedclub.tokens.expires_days'));
        $new = $user->createToken($device->name, [config()->string('speedclub.tokens.ability')], $expires);

        // M4.7 (09 §8.4): the install's row, created or refreshed; tokens of older app builds (no install id) have none.
        $install = $this->installs->record($user, $device);

        /** @var PersonalAccessToken $token */
        $token = $new->accessToken;
        $token->forceFill([
            'device_install_id' => $install?->id,
            'approx_city' => $install?->approx_city,
            'device_name' => $device->name,
            'device_id' => $device->id,
            'platform' => $device->platform,
            'app_version' => $device->appVersion,
            'reauthenticated_at' => $signedInNow ? now() : null,
            'second_factor_at' => $secondFactor ? now() : null,
        ])->save();

        return new AuthResult($user, $new->plainTextToken, $expires);
    }
}
