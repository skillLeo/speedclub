<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;

class RejectEventPhotoRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Shown to the uploader only ("Abgelehnt: …"). */
            'reason' => ['sometimes', 'nullable', 'string', 'max:'.config()->integer('speedclub.events.gallery_reason_max')],
        ];
    }

    public function reason(): ?string
    {
        $reason = $this->validated('reason');

        return is_string($reason) ? $reason : null;
    }
}
