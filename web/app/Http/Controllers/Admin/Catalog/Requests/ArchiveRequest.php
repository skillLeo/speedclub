<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/** ADM-15 "Archivieren" / "Wiederherstellen" of a field (`catalog.manage`, reason). */
class ArchiveRequest extends CatalogFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['archived' => ['required', 'boolean']];
    }
}
