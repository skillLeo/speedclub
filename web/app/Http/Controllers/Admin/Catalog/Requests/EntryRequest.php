<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/**
 * ADM-14 / ADM-16 "Neu" and "Bearbeiten" (`catalog.manage`, reason optional): the attributes of the level (CreateCatalogEntry,
 * UpdateCatalogEntry validate them with EntryRules); only these keys reach the Action.
 */
class EntryRequest extends CatalogFormRequest
{
    public const KEYS = ['name', 'slug', 'country', 'is_popular', 'sort', 'active', 'make_id', 'model_id', 'year_from', 'year_to', 'category_hint', 'aliases'];

    protected function reasonRequired(): bool
    {
        return false;
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:120'],
            'aliases' => ['sometimes', 'nullable', 'array', 'max:20'],
        ];
    }

    /**
     * The entry attributes sent, as the Action takes them.
     *
     * @return array<string, mixed>
     */
    public function values(): array
    {
        return $this->only(self::KEYS);
    }
}
