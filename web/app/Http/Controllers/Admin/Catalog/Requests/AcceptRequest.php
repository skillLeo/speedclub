<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/**
 * ADM-14 Anfragen "Übernehmen" (`catalog.manage`, reason optional): per level an existing entry (id) or a new one (name), as
 * AcceptCatalogRequest takes them; it validates the combination.
 */
class AcceptRequest extends CatalogFormRequest
{
    public const KEYS = ['make_id', 'make_name', 'country', 'model_id', 'model_name', 'generation_id', 'generation_name', 'year_from', 'year_to'];

    protected function reasonRequired(): bool
    {
        return false;
    }

    /**
     * @return array<string, mixed>
     */
    public function choice(): array
    {
        return array_filter($this->only(self::KEYS), fn (mixed $value): bool => $value !== null && $value !== '');
    }
}
