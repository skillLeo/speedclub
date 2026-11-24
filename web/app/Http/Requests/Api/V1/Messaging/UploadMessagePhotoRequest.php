<?php

namespace App\Http\Requests\Api\V1\Messaging;

use App\Http\Requests\Concerns\ValidatesPlateBlur;
use Illuminate\Foundation\Http\FormRequest;

/**
 * `POST conversations/{id}/media`: one photo for a message, through the media pipeline (JPEG, PNG or WebP, ≤ 15 MB, re-encoded).
 */
class UploadMessagePhotoRequest extends FormRequest
{
    use ValidatesPlateBlur;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file'],
            ...$this->plateBlurRules(),
        ];
    }
}
