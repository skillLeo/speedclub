<?php

namespace App\Http\Requests\Api\V1\Me;

use Illuminate\Foundation\Http\FormRequest;

/**
 * M4.15 (ADR-452): the endpoint of the subscription this browser drops.
 */
class RemovePushSubscriptionRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The push service URL the browser subscribed with. */
            'endpoint' => ['required', 'string', 'max:'.config()->integer('speedclub.web_push.endpoint_max_length')],
        ];
    }
}
