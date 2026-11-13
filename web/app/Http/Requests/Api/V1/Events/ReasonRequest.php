<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;

class ReasonRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Shown to everybody with an answer on EVT-02. */
            'reason' => ['required', 'string', 'min:3', 'max:'.config()->integer('speedclub.events.reason_max')],
        ];
    }
}
