<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/** ADM-17 "Übernehmen" (`catalog.import`, and `catalog.manage` on the route and in the Action; recent password; reason). */
class ImportApplyRequest extends CatalogFormRequest
{
    protected function atom(): string
    {
        return 'catalog.import';
    }
}
