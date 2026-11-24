<?php

namespace App\Http\Requests\Api\V1\Media;

use App\Enums\MediaCategory;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateMediaRequest extends FormRequest
{
    /** The API's limit per photo (m2.7-contract §1). */
    public const MAX_BLUR_REGIONS = 10;

    /** A rectangle turns at most this many degrees either way (Pixelator::MAX_ANGLE). */
    public const MAX_BLUR_ANGLE = 45;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'alt' => ['sometimes', 'nullable', 'string', 'max:500'],
            'focal_x' => ['nullable', 'numeric', 'between:0,1', 'required_with:focal_y'],
            'focal_y' => ['nullable', 'numeric', 'between:0,1', 'required_with:focal_x'],
            'category' => ['sometimes', 'required', Rule::enum(MediaCategory::class)->except(MediaCategory::Event)],
            /**
             * [SIG sig.plate_blur] Number plates or faces to pixelate, normalised 0–1 from the photo's top left, 1 to 10 rectangles; optional `angle` per rectangle, degrees clockwise about its centre, −45 to 45 (default 0). The server
             * pixelates them in the queue in every variant and in the original, which is replaced: the photo answers `processing` until
             * the new files are there, under new URLs. Only a finished photo of a vehicle or a modification.
             *
             * @var list<array{x: float, y: float, w: float, h: float, angle?: float}>
             */
            'blur_regions' => ['sometimes', 'array', 'list', 'min:1', 'max:'.self::MAX_BLUR_REGIONS],
            'blur_regions.*' => ['array:x,y,w,h,angle', 'required_array_keys:x,y,w,h'],
            'blur_regions.*.x' => ['numeric', 'between:0,1'],
            'blur_regions.*.y' => ['numeric', 'between:0,1'],
            'blur_regions.*.w' => ['numeric', 'gt:0', 'max:1'],
            'blur_regions.*.h' => ['numeric', 'gt:0', 'max:1'],
            'blur_regions.*.angle' => ['sometimes', 'numeric', 'between:-'.self::MAX_BLUR_ANGLE.','.self::MAX_BLUR_ANGLE],
            /**
             * M5.9a: pixelation can only be added, never taken off: `false` is refused with "Zum Ändern lädst du das Foto neu hoch."
             * (re-upload). Sending `true` changes nothing by itself; `blur_regions` does the work.
             */
            'plate_blur' => ['sometimes', 'accepted'],
        ];
    }

    /**
     * A rectangle must lie on the photo: x + w and y + h at most 1 (a rounding hair over is accepted).
     *
     * @return list<Closure(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            /** @var list<array{x: float|int|string, y: float|int|string, w: float|int|string, h: float|int|string}> $regions */
            $regions = $this->input('blur_regions', []);

            foreach ($regions as $index => $region) {
                if ((float) $region['x'] + (float) $region['w'] > 1.0001 || (float) $region['y'] + (float) $region['h'] > 1.0001) {
                    $validator->errors()->add("blur_regions.$index", (string) __('media.blur_outside'));
                }
            }
        }];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'blur_regions.max' => (string) __('media.blur_too_many', ['max' => self::MAX_BLUR_REGIONS]),
            'plate_blur.accepted' => (string) __('media.blur_final'),
            'blur_regions.*.angle' => (string) __('media.blur_angle', ['max' => self::MAX_BLUR_ANGLE]),
        ];
    }
}
