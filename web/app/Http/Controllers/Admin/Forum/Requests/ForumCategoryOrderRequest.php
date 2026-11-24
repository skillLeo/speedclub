<?php

namespace App\Http\Controllers\Admin\Forum\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM Forum › Kategorien: the new order of the categories of one parent (or of the top level). */
class ForumCategoryOrderRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.rules';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:1000'],
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['integer', 'distinct'],
        ];
    }

    /**
     * @return list<int>
     */
    public function ids(): array
    {
        return array_values(array_map(intval(...), (array) $this->validated('ids')));
    }
}
