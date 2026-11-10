<?php

namespace App\Http\Requests\Api\V1\Messaging;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `POST broadcasting/auth`, as pusher-js sends it: the private channel and the socket id.
 */
class ChannelAuthRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** private-user.{your id} or private-conversation.{id} */
            'channel_name' => ['required', 'string', 'max:100'],
            'socket_id' => ['required', 'string', 'regex:/\A\d{1,20}\.\d{1,20}\z/'],
        ];
    }
}
