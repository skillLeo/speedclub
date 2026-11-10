<?php

namespace Database\Seeders;

use App\Models\ModCategory;
use App\Models\ModCategoryField;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * The categories and fields of 02_PRODUCT_SPEC §3.3.
 *
 * Select fields hold options as [{value, label: {de, en}}]. Text fields may hold {pattern, example} instead.
 * Adds what is missing and leaves existing rows alone, so running it again never undoes an edit in ADM-15.
 */
class ModCategorySeeder extends Seeder
{
    use SeedsFromData;

    public function run(): void
    {
        /** @var list<array{key: string, name: array<string, string>, icon: string, fields: list<array<string, mixed>>}> $categories */
        $categories = $this->readJson('mod_categories.json');

        DB::transaction(function () use ($categories): void {
            foreach ($categories as $index => $data) {
                $category = ModCategory::query()->firstOrCreate(['key' => $data['key']], [
                    'name' => $data['name'],
                    'icon' => $data['icon'],
                    'sort' => $index + 1,
                ]);

                foreach ($data['fields'] as $fieldIndex => $field) {
                    ModCategoryField::query()->firstOrCreate(['category_id' => $category->id, 'key' => $field['key']], [
                        'label' => $field['label'],
                        'type' => $field['type'],
                        'unit' => $field['unit'] ?? null,
                        'min' => $field['min'] ?? null,
                        'max' => $field['max'] ?? null,
                        'step' => $field['step'] ?? null,
                        'options' => $field['options'] ?? null,
                        'required' => $field['required'] ?? false,
                        'searchable' => $field['searchable'] ?? false,
                        'facet' => $field['facet'] ?? false,
                        'sort' => $fieldIndex + 1,
                    ]);
                }
            }
        });
    }
}
