<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/** ADM-15 field order (`catalog.manage`, reason): every field id of the category, archived ones included, in the new order. */
class ReorderRequest extends CatalogFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['ids' => ['required', 'array', 'min:1', 'max:200'], 'ids.*' => ['integer']];
    }

    /**
     * @return list<int>
     */
    public function ids(): array
    {
        return array_values(array_map(intval(...), (array) $this->input('ids', [])));
    }
}
