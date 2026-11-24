<?php

namespace App\Http\Requests\Api\V1\Stickers;

use App\Enums\StickerTemplate;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST vehicles/{vehicle}/sticker-design/preview: an unsaved state of the editor, rendered and never stored.
 */
class PreviewStickerRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return StickerOptionRules::rules();
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return StickerOptionRules::messages();
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
