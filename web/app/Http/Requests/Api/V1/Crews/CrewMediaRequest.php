<?php

namespace App\Http\Requests\Api\V1\Crews;

use App\Http\Requests\Concerns\ValidatesPlateBlur;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Logo (square) or cover (16:9) of a crew; re-encoded without metadata like every upload.
 */
class CrewMediaRequest extends FormRequest
{
    use ValidatesPlateBlur;

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
            ...$this->plateBlurRules(),
        ];
    }

    /**
     * @return array{alt?: string|null, focal_x?: float|null, focal_y?: float|null}
     */
    public function mediaAttributes(): array
    {
        /** @var array{alt?: string|null, focal_x?: float|null, focal_y?: float|null} */
        return array_intersect_key($this->validated(), array_flip(['alt', 'focal_x', 'focal_y']));
    }
}
