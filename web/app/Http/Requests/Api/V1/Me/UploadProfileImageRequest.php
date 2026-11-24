<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Http\Requests\Concerns\ValidatesPlateBlur;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Size and real file type are checked on the bytes by App\Services\Media\MediaService (413 and 415).
 */
class UploadProfileImageRequest extends FormRequest
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
