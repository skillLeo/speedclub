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
 * ADM-15 field edit (`catalog.manage`, reason; m3.3 §1). On a field that has data (FieldData::count, soft-deleted modifications
 * included): the key is immutable (`field_key_locked`), the type cannot change (`field_type_locked`), and a narrower definition (options
 * removed, min/max/step/pattern tightened, required switched on) is refused while any stored value would fail it (`field_narrowing`), each
 * with the count of affected modifications. Labels, unit, searchable, facet and sort always change. An archived field is edited like any
 * other. One schema version; searchable, options or key rebuild the category's builds.
 */
class UpdateModField
{
    public function __construct(private readonly FieldData $data) {}

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, ModCategoryField $field, array $input, string $reason): ModCategoryField
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $valid = FieldRules::validate($input, $field);
        $category = ModCategory::query()->findOrFail((int) $field->getAttribute('category_id'));
        $rebuilds = array_intersect(array_keys($valid), ['searchable', 'options', 'key']) !== [];

        return ModFieldChange::run($staff, $category, $reason, 'field_updated', function () use ($field, $valid): ModCategoryField {
            /** @var ModCategoryField $row */
            $row = ModCategoryField::query()->whereKey($field->getKey())->lockForUpdate()->firstOrFail();
            $withData = FieldData::count($row);
            $row->forceFill($valid);
            $dirty = array_keys($row->getDirty());

            if ($dirty === []) {
                return $row;
            }

            if ($withData > 0 && in_array('key', $dirty, true)) {
                throw new CatalogRefused('field_key_locked', $withData);
            }

            if ($withData > 0 && in_array('type', $dirty, true)) {
                throw new CatalogRefused('field_type_locked', $withData);
            }

            if (in_array('key', $dirty, true) && ModCategoryField::query()->where('category_id', $row->getAttribute('category_id'))->where('key', $row->getAttribute('key'))->whereKeyNot($row->getKey())->exists()) {
                throw ValidationException::withMessages(['key' => [(string) __('validation.unique', ['attribute' => 'key'])]]);
            }

            if (array_intersect($dirty, ['options', 'min', 'max', 'step', 'required', 'type']) !== []) {
                $affected = $this->data->violations($row);

                if ($affected > 0) {
                    throw new CatalogRefused('field_narrowing', $affected);
                }
            }

            $row->save();

            return $row;
        }, rebuildsSearch: $rebuilds);
    }
}
