<?php

namespace App\Http\Requests\Api\V1\Signature;

use App\Services\Signature\ShareCards;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ShareCardRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** `story` 1080 × 1920 (default) or `square` 1080 × 1080. */
            'format' => ['sometimes', 'string', Rule::in(ShareCards::formats())],
        ];
    }

    public function cardFormat(): string
    {
        return $this->string('format', 'story')->toString();
    }
}
