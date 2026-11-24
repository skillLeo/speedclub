<?php

namespace App\Http\Requests\Api\V1\Forum;

use Illuminate\Foundation\Http\FormRequest;

/**
 * "Gelöst": the reply of this thread that solved it.
 */
class SetForumSolutionRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['post_id' => ['required', 'string', 'size:26']];
    }
}
