<?php

namespace App\Http\Requests\Api\V1\Media;

use App\Enums\MediaCategory;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Size and real file type are checked on the bytes by App\Services\Media\MediaService (413 and 415).
 */
class StoreVehicleMediaRequest extends FormRequest
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
            'category' => ['nullable', Rule::enum(MediaCategory::class)],
        ];
    }
}
