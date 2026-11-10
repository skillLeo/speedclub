<?php

namespace App\Http\Requests\Api\V1\Support;

use Illuminate\Foundation\Http\FormRequest;

class StoreTicketMessageRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'message' => ['required', 'string', 'min:2', 'max:'.config()->integer('speedclub.support.message_max_length')],
        ];
    }
}
