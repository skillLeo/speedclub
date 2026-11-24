<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Http\Requests\Concerns\ValidatesPlateBlur;
use Illuminate\Foundation\Http\FormRequest;

/**
 * M5.6 POST events/{slug}/gallery: one photo, multipart. Size and real file type are checked on the bytes by MediaService (413, 415:
 * JPEG, PNG or WebP; the app converts HEIC before sending), the shorter side (at least speedclub.events.gallery_min_short_side) by the
 * action. The plate decision is required here: every gallery upload passes the plate blur step first (ADR-509).
 */
class StoreEventPhotoRequest extends FormRequest
{
    use ValidatesPlateBlur;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $rules = $this->plateBlurRules();
        /** "1": pixelate `blur_regions` before any file is written (only the blurred derivative is ever public); "0": switched off. */
        $rules['plate_blur'] = ['required', 'boolean'];

        return [
            'file' => ['required', 'file'],
            /** Describes the photo for screen readers. */
            'alt' => ['nullable', 'string', 'max:'.config()->integer('speedclub.events.gallery_alt_max')],
            ...$rules,
        ];
    }

    public function alt(): ?string
    {
        $alt = $this->validated('alt');

        return is_string($alt) && trim($alt) !== '' ? trim($alt) : null;
    }
}
