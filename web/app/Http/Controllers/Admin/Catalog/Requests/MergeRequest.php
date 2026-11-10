<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/** ADM-14 / ADM-16 "Zusammenführen" (`catalog.manage`, recent password, reason): the survivor of the same level. */
class MergeRequest extends CatalogFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['target_id' => ['required', 'integer', 'min:1']];
    }
}
