<?php

namespace App\Http\Requests\Concerns;

use App\Services\Media\PlateBlurChoice;
use Closure;

/**
 * M5.9a "Kennzeichen unkenntlich machen" (10 §16.1, ADR-509, m5.9a-contract §1): the two optional multipart fields every upload that can
 * show a car takes, validated in one place. The request merges plateBlurRules() into its rules() and hands plateBlur() to the action,
 * which passes it to MediaService::reserve(). An upload request with a prepareForValidation() of its own calls decodeBlurRegions() there.
 *
 * - `plate_blur`: "1"/"0" (boolean). Absent: no blur, state `unchecked` (older builds, other clients).
 * - `blur_regions`: a JSON string (FormData) or an array of 1–8 rectangles {x, y, w, h, angle?}, normalised 0–1 to the photo as displayed
 *   (after EXIF orientation): x, y in [0, 1], w, h in [0.02, 1], x + w and y + h at most 1 (+ 0.0001 for 4-decimal rounding); `angle` in
 *   degrees clockwise about the centre, −45…45, absent = 0 (the unturned rectangle is the one that must lie on the photo). Required with
 *   `plate_blur=1`; ignored with `plate_blur=0` or without `plate_blur`.
 */
trait ValidatesPlateBlur
{
    /** At most this many rectangles per upload (contract §1; GAR-08's PATCH still takes 10). */
    public const UPLOAD_MAX_BLUR_REGIONS = 8;

    /** Smallest side of a rectangle, as a share of the photo (the app's MIN_REGION_SIDE). */
    public const MIN_BLUR_SIDE = 0.02;

    /** A rectangle turns at most this many degrees either way (Pixelator::MAX_ANGLE). */
    public const MAX_BLUR_ANGLE = 45;

    /** The fields an action passes to MediaService through plateBlur(), never as media attributes. */
    public const PLATE_BLUR_FIELDS = ['plate_blur', 'blur_regions'];

    /** A hair over the edge after rounding to 4 decimals is accepted. */
    private const EDGE_TOLERANCE = 0.0001;

    protected function prepareForValidation(): void
    {
        $this->decodeBlurRegions();
    }

    /**
     * FormData sends the rectangles as one JSON string; JSON bodies may send the array. Anything that does not decode to an array stays
     * as sent, so the `array` rule answers it.
     */
    protected function decodeBlurRegions(): void
    {
        $regions = $this->input('blur_regions');

        if (is_string($regions)) {
            $decoded = json_decode($regions, true, 4);

            if (is_array($decoded)) {
                $this->merge(['blur_regions' => $decoded]);
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    protected function plateBlurRules(): array
    {
        $tooSmall = (string) __('media.blur_too_small');

        return [
            /**
             * M5.9a "Kennzeichen unkenntlich machen": `1` pixelates `blur_regions` into the photo before any file is written (every
             * variant, OG image and share card comes from that master; the unblurred upload is deleted). `0`: the member switched it off.
             * Not sent: nothing is pixelated and the owner's plate check lists the photo. Shown to the owner only, as `plate_blur.state`.
             */
            'plate_blur' => ['sometimes', 'boolean'],
            /**
             * With `plate_blur=1`: 1–8 rectangles, normalised 0–1 from the top left of the photo as displayed (after EXIF orientation);
             * w and h at least 0.02, x + w and y + h at most 1. Optional `angle`: degrees clockwise about the rectangle's centre,
             * −45 to 45 (default 0), for a plate shot at an angle; the turned rectangle is pixelated. A JSON string (multipart) or an array.
             * Ignored otherwise.
             *
             * @var string|list<array{x: float, y: float, w: float, h: float, angle?: float}>
             */
            'blur_regions' => ['exclude_unless:plate_blur,1,true', 'required_if:plate_blur,1,true', 'list', 'min:1', 'max:'.self::UPLOAD_MAX_BLUR_REGIONS],
            'blur_regions.*' => ['array:x,y,w,h,angle', 'required_array_keys:x,y,w,h',
                function (string $attribute, mixed $value, Closure $fail): void {
                    if (! is_array($value) || ! $this->numericRegion($value)) {
                        return;
                    }

                    if ((float) $value['x'] + (float) $value['w'] > 1 + self::EDGE_TOLERANCE || (float) $value['y'] + (float) $value['h'] > 1 + self::EDGE_TOLERANCE) {
                        $fail((string) __('media.blur_outside'));
                    }
                },
            ],
            'blur_regions.*.x' => ['numeric', 'between:0,1'],
            'blur_regions.*.y' => ['numeric', 'between:0,1'],
            'blur_regions.*.w' => ['numeric', 'max:1', $this->minimumSide($tooSmall)],
            'blur_regions.*.h' => ['numeric', 'max:1', $this->minimumSide($tooSmall)],
            'blur_regions.*.angle' => ['sometimes', 'numeric', 'between:-'.self::MAX_BLUR_ANGLE.','.self::MAX_BLUR_ANGLE],
        ];
    }

    /**
     * @return array<string, string>
     */
    protected function plateBlurMessages(): array
    {
        $required = (string) __('media.blur_regions_required');

        return [
            'blur_regions.required_if' => $required,
            'blur_regions.min' => $required,
            'blur_regions.list' => (string) __('media.blur_regions_invalid'),
            'blur_regions.max' => (string) __('media.blur_too_many', ['max' => self::UPLOAD_MAX_BLUR_REGIONS]),
            'blur_regions.*.angle' => (string) __('media.blur_angle', ['max' => self::MAX_BLUR_ANGLE]),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return $this->plateBlurMessages();
    }

    /**
     * The member's decision for this upload, from the validated fields.
     */
    public function plateBlur(): PlateBlurChoice
    {
        $validated = $this->validated();

        if (! array_key_exists('plate_blur', $validated)) {
            return PlateBlurChoice::unchecked();
        }

        if (! $this->boolean('plate_blur')) {
            return PlateBlurChoice::declined();
        }

        /** @var list<array{x: float|int|string, y: float|int|string, w: float|int|string, h: float|int|string, angle?: float|int|string|null}> $regions */
        $regions = $validated['blur_regions'] ?? [];

        return PlateBlurChoice::blurred($regions);
    }

    /**
     * @return Closure(string, mixed, Closure(string): mixed): void
     */
    private function minimumSide(string $message): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($message): void {
            if (is_numeric($value) && (float) $value < self::MIN_BLUR_SIDE) {
                $fail($message);
            }
        };
    }

    /**
     * @param  array<mixed>  $region
     */
    private function numericRegion(array $region): bool
    {
        foreach (['x', 'y', 'w', 'h'] as $key) {
            if (! isset($region[$key]) || ! is_numeric($region[$key])) {
                return false;
            }
        }

        return true;
    }
}
