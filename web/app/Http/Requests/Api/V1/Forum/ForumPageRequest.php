<?php

namespace App\Http\Requests\Api\V1\Forum;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Cursor pages of the forum ordered by last activity or creation (FOR-05, linked threads).
 */
class ForumPageRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.forum.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor($this->cursorColumns())],
        ];
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.forum.page_size');
    }

    /**
     * @return list<string>
     */
    protected function cursorColumns(): array
    {
        return $this->route()?->getName() === 'api.v1.me.forum.threads'
            ? ['forum_threads.created_at', 'forum_threads.id']
            : ['forum_threads.last_activity_at', 'forum_threads.id'];
    }
}
