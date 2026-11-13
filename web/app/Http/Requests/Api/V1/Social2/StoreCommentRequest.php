<?php

namespace App\Http\Requests\Api\V1\Social2;

use Illuminate\Foundation\Http\FormRequest;

class StoreCommentRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:'.config()->integer('speedclub.social_2.comment_max')],
            'parent_id' => ['nullable', 'string', 'size:26'],
        ];
    }
}
