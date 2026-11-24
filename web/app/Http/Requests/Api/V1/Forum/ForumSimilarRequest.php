<?php

namespace App\Http\Requests\Api\V1\Forum;

use Illuminate\Foundation\Http\FormRequest;

/**
 * FOR-04 "Ähnliche Themen" while typing the title.
 */
class ForumSimilarRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'min:3', 'max:'.config()->integer('speedclub.forum.title_max')],
            'category' => ['nullable', 'string', 'max:80'],
        ];
    }
}
