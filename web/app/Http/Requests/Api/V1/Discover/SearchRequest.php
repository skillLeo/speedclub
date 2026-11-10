<?php

namespace App\Http\Requests\Api\V1\Discover;

use App\Enums\SearchSort;
use App\Http\Requests\Api\V1\Discover\Concerns\ValidatesSearchFilters;
use App\Rules\ValidCursor;
use App\Services\Discover\SearchCursor;
use App\Services\Discover\SearchFilterResolver;
use App\Services\Discover\TextSearch;
use App\Services\Search\SearchTerms;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * DISC-02 search of vehicles and the overview. `q` needs one letter or digit; only its first six words count. With the filters of M2.3
 * and a sort, `q` is optional as soon as a filter or a sort is set ("Alle" of Neue Builds is `sort=newest` alone). Members:
 * MemberSearchRequest.
 *
 * A vehicle cursor belongs to its list: the sort's columns plus a signature of text, filters and sort (SearchCursor). The overview takes
 * none.
 */
class SearchRequest extends FormRequest
{
    use ValidatesSearchFilters;

    private const VEHICLES = 'api.v1.search.vehicles';

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Optional once a filter or `sort` is set. */
            'q' => [
                Rule::requiredIf(fn (): bool => ! $this->hasCriteria()),
                'nullable',
                'string',
                'max:'.config()->integer('speedclub.search.query_max_length'),
                'regex:/[\p{L}\p{N}]/u',
            ],
            ...$this->filterRules(),
            'sort' => ['nullable', Rule::enum(SearchSort::class)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.search.max_page_size')],
            // A cursor of search/vehicles, bound to its text, filters and sort; the overview takes none.
            'cursor' => $this->route()?->getName() === self::VEHICLES ? ['nullable', 'string', 'max:1000'] : ['prohibited'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            ...$this->filterMessages(),
            'q.required' => (string) __('discover.query_required'),
            'q.string' => (string) __('discover.query_required'),
            'q.max' => (string) __('discover.query_too_long', ['max' => config()->integer('speedclub.search.query_max_length')]),
            'q.regex' => (string) __('discover.query_invalid'),
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [
            $this->resolveFilters(...),
            function (Validator $validator): void {
                if ($validator->errors()->isNotEmpty() || $this->route()?->getName() !== self::VEHICLES || ! $this->filled('cursor')) {
                    return;
                }

                $sort = $this->sort();
                $rule = new ValidCursor(SearchCursor::columns($sort), [
                    SearchCursor::COLUMN => SearchCursor::signature('search', $this->vehicleWords(), $this->filters(), $sort),
                ]);

                if (! $rule->passes($this->input('cursor'))) {
                    $validator->errors()->add('cursor', (string) __('errors.cursor_invalid'));
                }
            },
        ];
    }

    public function searchQuery(): string
    {
        return trim($this->string('q')->toString());
    }

    /**
     * Null when no text was typed: then only the filters (or nothing at all) narrow the builds.
     *
     * @return list<string>|null
     */
    public function vehicleWords(): ?array
    {
        return $this->searchQuery() === '' ? null : SearchTerms::queryWords($this->searchQuery());
    }

    /**
     * Members are found by text only: without `q` the overview's member tab stays empty.
     *
     * @return list<string>
     */
    public function memberWords(): array
    {
        return SearchTerms::nameWords($this->searchQuery());
    }

    /**
     * The sort that applies: relevance with a text, newest without (also when relevance was asked for without a text).
     */
    public function sort(): SearchSort
    {
        return TextSearch::sortFor($this->vehicleWords(), $this->enum('sort', SearchSort::class));
    }

    /**
     * "?per_page=" passes `nullable` as null, which integer() would read as 0 and so answer an empty page: it means the default.
     */
    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.search.page_size');
    }

    /**
     * A filter or a sort is something to search for without a text.
     */
    private function hasCriteria(): bool
    {
        foreach (['make', 'model', 'generation', 'year_min', 'year_max', 'power_min', 'power_max', 'sort', ...SearchFilterResolver::LIST_KEYS] as $key) {
            if ($this->filled($key)) {
                return true;
            }
        }

        return false;
    }
}
