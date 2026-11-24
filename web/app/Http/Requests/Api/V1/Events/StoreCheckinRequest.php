<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;

class StoreCheckinRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The six characters under the organiser's QR (or from the scanned link); case and spaces do not matter. */
            'code' => ['required', 'string', 'max:12'],
            /** "War dabei" on the member's profile once the event has ended. Default true. */
            'profile_visible' => ['sometimes', 'boolean'],
        ];
    }

    public function code(): string
    {
        return (string) $this->validated('code');
    }

    public function profileVisible(): bool
    {
        return $this->boolean('profile_visible', true);
    }
}
