<?php

namespace App\Http\Requests\Api\V1\Ai;

use App\Enums\TranslationSource;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class TranslateRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'source' => ['required', Rule::enum(TranslationSource::class)],
            /** The id of the vehicle, the build update or the message. */
            'id' => ['required', 'string', 'ulid'],
            'to' => ['required', Rule::in(config()->array('speedclub.locales'))],
        ];
    }
}
