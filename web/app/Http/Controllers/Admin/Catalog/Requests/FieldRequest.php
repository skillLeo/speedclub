<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/**
 * ADM-15 field add / edit (`catalog.manage`, reason: every save is one schema version). FieldRules validates the field in the Action.
 * `searchable` and `facet` are not taken from the page (ADR-235: read-only in V1, the Discover facet set is fixed).
 */
class FieldRequest extends CatalogFormRequest
{
    public const KEYS = ['key', 'label', 'type', 'unit', 'min', 'max', 'step', 'options', 'required', 'sort'];

    /**
     * @return array<string, mixed>
     */
    public function values(): array
    {
        return $this->only(self::KEYS);
    }
}
