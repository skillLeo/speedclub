<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Size and real file type are checked on the bytes by App\Services\Media\MediaService (413 and 415), as for every upload.
 */
class StoreEventCoverRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file'],
            'alt' => ['nullable', 'string', 'max:500'],
            'focal_x' => ['nullable', 'numeric', 'between:0,1', 'required_with:focal_y'],
            'focal_y' => ['nullable', 'numeric', 'between:0,1', 'required_with:focal_x'],
        ];
    }
}
