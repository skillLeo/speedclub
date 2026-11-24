<?php

namespace App\Http\Requests\Api\V1\Gift;

use Illuminate\Foundation\Http\FormRequest;

class MarkBadgesSeenRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The keys the unlock toast showed.
            'keys' => ['required', 'array', 'min:1', 'max:100'],
            'keys.*' => ['required', 'string', 'max:64'],
        ];
    }

    /**
     * @return list<string>
     */
    public function keys(): array
    {
        /** @var list<string> $keys */
        $keys = array_values(array_unique($this->validated('keys')));

        return $keys;
    }
}
