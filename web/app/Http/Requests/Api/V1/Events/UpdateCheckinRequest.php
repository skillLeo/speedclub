<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;

class UpdateCheckinRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** "Auf meinem Profil zeigen" (after the event has ended). */
            'profile_visible' => ['required', 'boolean'],
        ];
    }
}
