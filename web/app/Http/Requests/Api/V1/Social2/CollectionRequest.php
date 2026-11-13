<?php

namespace App\Http\Requests\Api\V1\Social2;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST and PATCH me/collections: the name. Blank names are refused; the default collection may be renamed.
 */
class CollectionRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['name' => ['required', 'string', 'max:'.config()->integer('speedclub.social_2.collection_name_max')]];
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('name'))) {
            $this->merge(['name' => trim($this->input('name'))]);
        }
    }
}
