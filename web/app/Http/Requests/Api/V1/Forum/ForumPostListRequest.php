<?php

namespace App\Http\Requests\Api\V1\Forum;

use App\Enums\ForumPostSort;
use App\Rules\ValidCursor;
use App\Services\Forum\ForumListing;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * FOR-03 replies: `sort` oldest (default) or helpful (the most "Hilfreich" first).
 */
class ForumPostListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'sort' => ['nullable', Rule::enum(ForumPostSort::class)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.forum.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(ForumListing::replyCursorColumns($this->sort()))],
        ];
    }

    public function sort(): ForumPostSort
    {
        return ForumPostSort::tryFrom($this->string('sort')->value()) ?? ForumPostSort::Oldest;
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.forum.page_size');
    }
}
