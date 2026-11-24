<?php

namespace App\Http\Requests\Api\V1\Stickers;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST vehicles/{vehicle}/sticker-design/versions/{version}/restore: STK-07 "Wiederherstellen".
 */
class RestoreStickerDesignRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The revision the app last saw of the current version (0 before the first save). Review MF-4.
            'base_revision' => ['required', 'integer', 'min:0'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return StickerOptionRules::baseRevisionMessages();
    }

    public function baseRevision(): int
    {
        return (int) $this->validated('base_revision');
    }
}
