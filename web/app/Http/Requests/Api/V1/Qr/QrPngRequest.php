<?php

namespace App\Http\Requests\Api\V1\Qr;

use App\Services\Qr\QrRenderer;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class QrPngRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'size' => ['nullable', 'integer', Rule::in(QrRenderer::PNG_SIZES)],
        ];
    }

    /**
     * @return 1024|2048
     */
    public function size(): int
    {
        return $this->integer('size') === QrRenderer::PNG_SIZES[1] ? QrRenderer::PNG_SIZES[1] : QrRenderer::PNG_SIZES[0];
    }
}
