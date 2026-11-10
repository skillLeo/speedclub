<?php

namespace App\Http\Requests\Api\V1\Discover;

use App\Enums\SearchSort;
use App\Models\Generation;
use App\Models\VehicleModel;
use App\Rules\ValidCursor;
use App\Services\Catalog\CatalogSlugs;
use App\Services\Discover\ModelKey;
use App\Services\Discover\SearchCursor;
use App\Services\Discover\SearchFilters;
use App\Services\Discover\TextSearch;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * DISC-04 lists: the builds of a model (`discover/models/{model}/builds`) and its wheel-setup table (`…/wheel-setups`), optionally of one
 * generation. Builds sort like DISC-02 without a text (newest by default); the table always lists the newest change first. A cursor
 * belongs to its model, generation and sort.
 */
class ModelBuildsRequest extends FormRequest
{
    protected const WHEELS = 'api.v1.discover.models.wheel-setups';

    private ?VehicleModel $catalogModel = null;

    private ?Generation $catalogGeneration = null;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Generation slug of this model ("g82"). */
            'generation' => ['nullable', 'string', 'max:140'],
            /** `newest` (default), `updated` or `power`. */
            'sort' => ['nullable', Rule::enum(SearchSort::class)->except([SearchSort::Relevance])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.search.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000'],
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty() || $this->model() === null) {
                return;
            }

            if ($this->filled('generation')) {
                $this->catalogGeneration = CatalogSlugs::generation($this->model(), $this->string('generation')->toString());

                if ($this->catalogGeneration === null) {
                    $validator->errors()->add('generation', (string) __('discover.filters.unknown_generation'));

                    return;
                }
            }

            if ($this->filled('cursor')) {
                $rule = new ValidCursor($this->cursorColumns(), [SearchCursor::COLUMN => $this->signature()]);

                if (! $rule->passes($this->input('cursor'))) {
                    $validator->errors()->add('cursor', (string) __('errors.cursor_invalid'));
                }
            }
        }];
    }

    /**
     * The catalogue model of the route key ("bmw--m4"); null for a key that names none (the controller answers 404).
     */
    public function model(): ?VehicleModel
    {
        if ($this->catalogModel === null) {
            $key = $this->route('model');
            $this->catalogModel = is_string($key) ? ModelKey::find($key) : null;
        }

        return $this->catalogModel;
    }

    public function filters(): SearchFilters
    {
        $model = $this->model();

        return new SearchFilters(make: $model?->make, model: $model, generation: $this->catalogGeneration);
    }

    public function sort(): SearchSort
    {
        return $this->route()?->getName() === self::WHEELS ? SearchSort::Updated : TextSearch::sortFor(null, $this->enum('sort', SearchSort::class));
    }

    public function signature(): string
    {
        return SearchCursor::signature((string) $this->route()?->getName(), null, $this->filters(), $this->sort());
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.search.page_size');
    }

    /**
     * @return list<string>
     */
    private function cursorColumns(): array
    {
        return $this->route()?->getName() === self::WHEELS
            ? [SearchCursor::COLUMN, 'sort_at', 'id']
            : SearchCursor::columns($this->sort());
    }
}
