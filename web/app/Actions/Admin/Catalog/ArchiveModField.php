<?php

namespace App\Actions\Admin\Catalog;

use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Catalog\CatalogRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-15 "Archivieren" / "Wiederherstellen" (`catalog.manage`, reason): an archived field is not offered for new entries (the catalogue
 * API marks it `archived`; it is never required, so the garage does not ask for it) and is still displayed and exported on existing
 * modifications. Restoring keeps `required` off; switching it on again is an edit with the narrowing rule. One schema version.
 */
class ArchiveModField
{
    /**
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, ModCategoryField $field, bool $archived, string $reason): ModCategoryField
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $category = ModCategory::query()->findOrFail((int) $field->getAttribute('category_id'));

        return ModFieldChange::run($staff, $category, $reason, $archived ? 'field_archived' : 'field_restored', function () use ($field, $archived): ModCategoryField {
            /** @var ModCategoryField $row */
            $row = ModCategoryField::query()->whereKey($field->getKey())->lockForUpdate()->firstOrFail();

            if ($row->isArchived() === $archived) {
                return $row;
            }

            $row->forceFill($archived ? ['archived_at' => now(), 'required' => false] : ['archived_at' => null])->save();

            return $row;
        });
    }
}
