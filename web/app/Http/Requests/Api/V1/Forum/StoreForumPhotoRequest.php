<?php

namespace App\Http\Requests\Api\V1\Forum;

use App\Http\Requests\Concerns\ValidatesPlateBlur;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A thread photo. Size and real file type are checked on the bytes by MediaService (413 and 415), as for every upload.
 */
class StoreForumPhotoRequest extends FormRequest
{
    use ValidatesPlateBlur;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file'],
            'alt' => ['nullable', 'string', 'max:500'],
            ...$this->plateBlurRules(),
        ];
    }
}
