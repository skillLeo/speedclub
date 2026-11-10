<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/** ADM-14 "Deaktivieren" / "Aktivieren" (`catalog.manage`, reason). */
class ActiveRequest extends CatalogFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['active' => ['required', 'boolean']];
    }
}
