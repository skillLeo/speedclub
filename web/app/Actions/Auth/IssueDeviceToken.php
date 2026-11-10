<?php

namespace App\Actions\Auth;

use App\Models\PersonalAccessToken;
use App\Models\PushToken;
use App\Models\User;
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
    public function handle(User $user, DeviceInfo $device): AuthResult
    {
        return DB::transaction(function () use ($user, $device): AuthResult {
            $same = $user->tokens();

            if ($device->id !== null) {
                $same->where('device_id', $device->id);
                // The install now belongs to this member: the last member's push token there must not get this one's pushes, nor the
                // reverse (M2.2 review #5).
                PushToken::query()->where('device_id', $device->id)->where('user_id', '!=', $user->id)->delete();
            } else {
                $same->whereNull('device_id')->where('device_name', $device->name)->where('platform', $device->platform);
            }

            $same->delete();

            return $this->create($user, $device);
        });
    }

    /**
     * Also used for rotation, which keeps the device data.
     */
    public function create(User $user, DeviceInfo $device): AuthResult
    {
        $expires = now()->addDays(config()->integer('speedclub.tokens.expires_days'));
        $new = $user->createToken($device->name, [config()->string('speedclub.tokens.ability')], $expires);

        /** @var PersonalAccessToken $token */
        $token = $new->accessToken;
        $token->forceFill([
            'device_name' => $device->name,
            'device_id' => $device->id,
            'platform' => $device->platform,
            'app_version' => $device->appVersion,
        ])->save();

        return new AuthResult($user, $new->plainTextToken, $expires);
    }
}
