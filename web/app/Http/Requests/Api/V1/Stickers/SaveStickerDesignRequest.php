<?php

namespace App\Http\Requests\Api\V1\Stickers;

use App\Enums\StickerTemplate;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PUT vehicles/{vehicle}/sticker-design: the autosave of STK-05.
 */
class SaveStickerDesignRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The version the app last saw; 0 before the first save.
            'base_version' => ['required', 'integer', 'min:0'],
            // The revision the app last saw (`revision` of the design; 0 before the first save). Review MF-4.
            'base_revision' => ['required', 'integer', 'min:0'],
            ...StickerOptionRules::rules(),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [...StickerOptionRules::messages(), ...StickerOptionRules::baseRevisionMessages()];
    }

    public function baseVersion(): int
    {
        return (int) $this->validated('base_version');
    }

    public function baseRevision(): int
    {
        return (int) $this->validated('base_revision');
    }

    public function template(): StickerTemplate
    {
        return StickerTemplate::from((string) $this->validated('template'));
    }

    /**
     * @return array<string, mixed>
     */
    public function options(): array
    {
        $options = $this->validated('options');

        return is_array($options) ? $options : [];
    }
}
