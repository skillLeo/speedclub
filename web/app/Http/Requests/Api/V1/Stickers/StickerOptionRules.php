<?php

namespace App\Http\Requests\Api\V1\Stickers;

use App\Enums\StickerColourway;
use App\Enums\StickerMaterial;
use App\Enums\StickerSize;
use App\Enums\StickerTemplate;
use App\Services\Stickers\StickerFonts;
use Closure;
use Illuminate\Validation\Rule;

/**
 * The field rules of a design's template and options (m5.4-contract §1.1), shared by autosave and preview. The rules that span two
 * options (white ink needs transparent vinyl, mirrored needs transparent) run in SaveStickerDesign once the stored options are merged.
 */
final class StickerOptionRules
{
    /**
     * @return array<string, mixed>
     */
    public static function rules(): array
    {
        return [
            'template' => ['required', 'string', Rule::enum(StickerTemplate::class)],
            'options' => ['present', 'array:size,colourway,material,qr,username,car_name,custom_line,mirrored'],
            'options.size' => ['sometimes', 'string', Rule::enum(StickerSize::class)],
            'options.colourway' => ['sometimes', 'string', Rule::enum(StickerColourway::class)],
            'options.material' => ['sometimes', 'string', Rule::enum(StickerMaterial::class)],
            'options.qr' => ['sometimes', 'boolean:strict'],
            'options.username' => ['sometimes', 'boolean:strict'],
            'options.car_name' => ['sometimes', 'boolean:strict'],
            'options.mirrored' => ['sometimes', 'boolean:strict'],
            'options.custom_line' => [
                'sometimes', 'nullable', 'string', 'max:'.config()->integer('speedclub.stickers.custom_line_max', 24),
                // One printable line: no line breaks, tabs or other control and format characters.
                'regex:/\A[^\p{C}]*\z/u',
                function (string $attribute, mixed $value, Closure $fail): void {
                    if (is_string($value) && ! StickerFonts::covers(StickerFonts::LINE, trim($value))) {
                        $fail((string) __('stickers.validation.unprintable'));
                    }
                },
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function messages(): array
    {
        return [
            'options.custom_line.max' => (string) __('stickers.validation.custom_line_max', ['max' => config()->integer('speedclub.stickers.custom_line_max', 24)]),
            'options.custom_line.regex' => (string) __('stickers.validation.one_line'),
        ];
    }

    /**
     * The draft revision of the autosave and the restore (review MF-4): a client bug if it is wrong, so one plain message.
     *
     * @return array<string, string>
     */
    public static function baseRevisionMessages(): array
    {
        $message = (string) __('stickers.validation.base_revision');

        return ['base_revision.required' => $message, 'base_revision.integer' => $message, 'base_revision.min' => $message];
    }
}
