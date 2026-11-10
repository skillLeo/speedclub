<?php

namespace App\Http\Requests\Api\V1\Social;

use App\Rules\ValidCursor;
use App\Services\Search\SearchTerms;
use App\Services\Social\Connections;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PROF-04 lists: `per_page` (30, at most 50), the cursor, and the search field `q` (at most 64 characters).
 */
class ConnectionListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'q' => ['nullable', 'string', 'max:'.config()->integer('speedclub.social.query_max_length')],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.social.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(Connections::CURSOR_COLUMNS)],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'q.max' => (string) __('social.query_too_long', ['max' => config()->integer('speedclub.social.query_max_length')]),
        ];
    }

    /**
     * The name words to look for; null when nothing was typed. A query of nothing but punctuation has no words and finds nobody.
     *
     * @return list<string>|null
     */
    public function nameWords(): ?array
    {
        $query = trim($this->string('q')->toString());

        return $query === '' ? null : SearchTerms::nameWords($query);
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.social.page_size');
    }
}
