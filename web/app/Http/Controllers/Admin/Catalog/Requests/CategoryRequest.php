<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/**
 * ADM-15 category create (reason optional) and edit (reason required) (`catalog.manage`): {key, name {de, en}, icon, sort, active},
 * validated by CategoryRules in the Action.
 */
class CategoryRequest extends CatalogFormRequest
{
    public const KEYS = ['key', 'name', 'icon', 'sort', 'active'];

    protected function reasonRequired(): bool
    {
        return $this->isMethod('PATCH');
    }

    /**
     * @return array<string, mixed>
     */
    public function values(): array
    {
        return $this->only(self::KEYS);
    }
}
