<?php

namespace App\Http\Requests\Api\V1\Discover;

use App\Http\Requests\Api\V1\Discover\Concerns\ValidatesSearchFilters;
use App\Services\Search\SearchTerms;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * GET search/facets: the parameters of search/vehicles without sort and page. Nothing set means every visible build.
 */
class FacetsRequest extends FormRequest
{
    use ValidatesSearchFilters;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'q' => ['nullable', 'string', 'max:'.config()->integer('speedclub.search.query_max_length'), 'regex:/[\p{L}\p{N}]/u'],
            ...$this->filterRules(),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            ...$this->filterMessages(),
            'q.max' => (string) __('discover.query_too_long', ['max' => config()->integer('speedclub.search.query_max_length')]),
            'q.regex' => (string) __('discover.query_invalid'),
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [$this->resolveFilters(...)];
    }

    /**
     * @return list<string>|null
     */
    public function vehicleWords(): ?array
    {
        $query = trim($this->string('q')->toString());

        return $query === '' ? null : SearchTerms::queryWords($query);
    }
}
