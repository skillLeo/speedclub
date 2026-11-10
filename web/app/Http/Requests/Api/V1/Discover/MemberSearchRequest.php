<?php

namespace App\Http\Requests\Api\V1\Discover;

use App\Rules\ValidCursor;
use App\Services\Search\SearchTerms;
use Illuminate\Foundation\Http\FormRequest;

/**
 * DISC-02 members: `q` is needed (one letter or digit, the first six words count). The cursor pages by relevance and username.
 */
class MemberSearchRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'q' => ['required', 'string', 'max:'.config()->integer('speedclub.search.query_max_length'), 'regex:/[\p{L}\p{N}]/u'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.search.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(['relevance', 'username'])],
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

    /**
     * @return list<string>
     */
    public function memberWords(): array
    {
        return SearchTerms::nameWords(trim($this->string('q')->toString()));
    }

    /**
     * "?per_page=" passes `nullable` as null, which integer() would read as 0 and so answer an empty page: it means the default.
     */
    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.search.page_size');
    }
}
