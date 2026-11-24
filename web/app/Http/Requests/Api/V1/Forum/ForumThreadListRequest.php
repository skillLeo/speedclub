<?php

namespace App\Http\Requests\Api\V1\Forum;

use App\Enums\ForumThreadSort;
use App\Services\Forum\ForumListing;
use Illuminate\Validation\Rule;

/**
 * FOR-01/02: `category` (a slug; a parent category includes its sub-categories), `tag`, `sort` Aktiv · Neu · Unbeantwortet · Gelöst.
 */
class ForumThreadListRequest extends ForumPageRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'category' => ['nullable', 'string', 'max:80'],
            'tag' => ['nullable', 'string', 'max:24'],
            'sort' => ['nullable', Rule::enum(ForumThreadSort::class)],
        ];
    }

    public function sort(): ForumThreadSort
    {
        return ForumThreadSort::tryFrom($this->string('sort')->value()) ?? ForumThreadSort::Active;
    }

    /**
     * @return list<string>
     */
    protected function cursorColumns(): array
    {
        return ForumListing::cursorColumns($this->sort());
    }
}
