<?php

namespace App\Http\Controllers\Admin\Parts\Requests;

use App\Http\Controllers\Admin\Catalog\Requests\CatalogFormRequest;

/**
 * ADM-57 archive, restore and merge: catalog.manage and a reason (10–1000 characters); merge names the survivor (`into`).
 */
class ProductStateRequest extends CatalogFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return $this->routeIs('admin.catalog.products.merge') ? ['into' => ['required', 'string', 'size:26']] : [];
    }

    public function reasonText(): string
    {
        return trim($this->string('reason')->value());
    }
}
