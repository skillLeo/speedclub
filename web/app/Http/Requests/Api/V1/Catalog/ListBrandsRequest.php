<?php

namespace App\Http\Requests\Api\V1\Catalog;

class ListBrandsRequest extends CatalogListRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'category' => ['nullable', 'string', 'max:40'],
        ];
    }
}
