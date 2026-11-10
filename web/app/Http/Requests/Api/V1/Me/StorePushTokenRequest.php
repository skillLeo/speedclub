<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Enums\DevicePlatform;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Auth\DeviceInfo;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * AUTH-10: the Expo push token of this app install. Web has no push.
 */
class StorePushTokenRequest extends FormRequest
{
    /** Expo's format: ExponentPushToken[…] (or ExpoPushToken[…]). */
    public const TOKEN_PATTERN = '/\AExp(?:onent|o)PushToken\[[A-Za-z0-9_-]{8,200}\]\z/';

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** An Expo push token, "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]". */
            'token' => ['required', 'string', 'max:255', 'regex:'.self::TOKEN_PATTERN],
            'platform' => ['required', 'string', Rule::in([DevicePlatform::Ios->value, DevicePlatform::Android->value])],
            /** The install id the app sends at sign-in (DeviceInfo::ID_PATTERN); one token per install. */
            'device_id' => ['required', 'string', 'regex:'.DeviceInfo::ID_PATTERN],
        ];
    }

    /**
     * A device signed in with an install id registers for that install only (M2.2 review #6): another id is a 422, so no token can
     * claim somebody else's install.
     *
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $user = $this->user();
            $token = $user instanceof User ? $user->currentAccessToken() : null;
            // A stored token only: the cookie session of the web app has none, and neither has a test's stand-in.
            $own = $token instanceof PersonalAccessToken && $token->exists ? $token->deviceId() : null;

            if ($own !== null && ! $validator->errors()->has('device_id') && $this->input('device_id') !== $own) {
                $validator->errors()->add('device_id', (string) __('validation.push_device_mismatch'));
            }
        }];
    }
}
