<?php

namespace App\Http\Requests\Api\V1\Crews;

use App\Enums\Bundesland;
use App\Rules\ValidCursor;
use App\Services\Crews\CrewListing;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * CREW-00: `q` (part of the name), `bundesland`, `sort` name (A–Z, default) or newest. Never by size (contract-crews.md C2).
 */
class CrewListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $columns = $this->input('sort') === CrewListing::SORT_NEWEST ? CrewListing::CURSOR_NEWEST : CrewListing::CURSOR_NAME;

        return [
            'q' => ['sometimes', 'nullable', 'string', 'min:2', 'max:40'],
            'bundesland' => ['sometimes', 'nullable', Rule::enum(Bundesland::class)],
            'sort' => ['sometimes', 'string', Rule::in([CrewListing::SORT_NAME, CrewListing::SORT_NEWEST])],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.crews.max_page_size')],
            /** The `next_cursor` of the previous page of the same sort. Any other cursor is refused with 422. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor($columns)],
        ];
    }

    /**
     * @return array{q: string|null, bundesland: string|null, sort: string}
     */
    public function filters(): array
    {
        $q = $this->validated('q');
        $bundesland = $this->validated('bundesland');
        $sort = $this->validated('sort');

        return [
            'q' => is_string($q) && trim($q) !== '' ? trim($q) : null,
            'bundesland' => is_string($bundesland) ? $bundesland : null,
            'sort' => is_string($sort) ? $sort : CrewListing::SORT_NAME,
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.crews.page_size'));
    }
}
