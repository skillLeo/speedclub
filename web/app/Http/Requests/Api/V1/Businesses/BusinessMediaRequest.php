<?php

namespace App\Http\Requests\Api\V1\Businesses;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Logo (square, shown at 56) or cover (16:9) of a business; re-encoded without metadata like every upload.
 */
class BusinessMediaRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Type, size and pixels are checked by MediaService::inspectUpload (as for every upload).
            'file' => ['required', 'file'],
            'alt' => ['nullable', 'string', 'max:500'],
            'focal_x' => ['nullable', 'numeric', 'between:0,1', 'required_with:focal_y'],
            'focal_y' => ['nullable', 'numeric', 'between:0,1', 'required_with:focal_x'],
        ];
    }
}
