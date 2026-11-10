<?php

namespace App\Actions\Admin\Catalog;

use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\FieldData;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-15 "Löschen" of a field (`catalog.manage`, reason): only a field no modification has data in, soft-deleted ones included;
 * otherwise `field_has_data` with the count, and the page offers Archivieren (m3.3 §1). One schema version.
 */
class DeleteModField
{
    /**
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, ModCategoryField $field, string $reason): void
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $category = ModCategory::query()->findOrFail((int) $field->getAttribute('category_id'));

        ModFieldChange::run($staff, $category, $reason, 'field_deleted', function () use ($field): void {
            /** @var ModCategoryField $row */
            $row = ModCategoryField::query()->whereKey($field->getKey())->lockForUpdate()->firstOrFail();
            $withData = FieldData::count($row);

            if ($withData > 0) {
                throw new CatalogRefused('field_has_data', $withData);
            }

            $row->delete();
        }, rebuildsSearch: (bool) $field->getAttribute('searchable'));
    }
}
