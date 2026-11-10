<?php

namespace App\Http\Requests\Api\V1\Discover;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET search/interpret: what the catalogue understands in a typed query (m2.3 contract §3).
 */
class InterpretRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'q' => ['required', 'string', 'max:'.config()->integer('speedclub.search.query_max_length'), 'regex:/[\p{L}\p{N}]/u'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'q.required' => (string) __('discover.query_required'),
            'q.string' => (string) __('discover.query_required'),
            'q.max' => (string) __('discover.query_too_long', ['max' => config()->integer('speedclub.search.query_max_length')]),
            'q.regex' => (string) __('discover.query_invalid'),
        ];
    }

    public function searchQuery(): string
    {
        return trim($this->string('q')->toString());
    }
}
