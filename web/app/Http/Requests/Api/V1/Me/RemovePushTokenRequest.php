<?php

namespace App\Http\Requests\Api\V1\Me;

use Illuminate\Foundation\Http\FormRequest;

/**
 * DELETE me/push-tokens/{deviceId}: the install id in the path follows DeviceInfo::ID_PATTERN like everywhere else (M2.2 review #20),
 * enforced by the route constraint.
 */
class RemovePushTokenRequest extends FormRequest
{
    /**
     * The install id in the path is checked by the route (`DeviceInfo::ROUTE_PATTERN`): a malformed id matches no route and
     * answers 404. Validating it here would make Scramble document a second, query `device_id` parameter that the API never reads.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [];
    }

    public function deviceId(): string
    {
        return (string) $this->route('deviceId');
    }
}
