<?php

namespace App\Actions\Admin\Catalog;

use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\FieldData;
use App\Services\Catalog\FieldRules;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-15 "Feld hinzufügen" (`catalog.manage`, reason): a new field at the end unless a sort is given. A required field is refused while
 * stored modifications of the category lack it (`field_narrowing` with their count): their owners could no longer save them. One schema
 * version; a searchable field rebuilds the category's builds.
 */
class CreateModField
{
    public function __construct(private readonly FieldData $data) {}

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, ModCategory $category, array $input, string $reason): ModCategoryField
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $valid = FieldRules::validate($input, null);

        return ModFieldChange::run($staff, $category, $reason, 'field_created', function (ModCategory $locked) use ($valid): ModCategoryField {
            if (ModCategoryField::query()->where('category_id', $locked->getKey())->where('key', $valid['key'])->exists()) {
                throw ValidationException::withMessages(['key' => [(string) __('validation.unique', ['attribute' => 'key'])]]);
            }

            if (! array_key_exists('sort', $valid)) {
                $max = ModCategoryField::query()->where('category_id', $locked->getKey())->max('sort');
                $valid['sort'] = is_numeric($max) ? (int) $max + 1 : 1;
            }

            $field = new ModCategoryField;
            $field->forceFill(['category_id' => $locked->getKey(), ...$valid]);

            $affected = $this->data->violations($field);

            if ($affected > 0) {
                throw new CatalogRefused('field_narrowing', $affected);
            }

            $field->save();

            return $field;
        }, rebuildsSearch: (bool) ($valid['searchable'] ?? false));
    }
}
