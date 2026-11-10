<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Actions\Admin\Catalog\CreateModCategory;
use App\Actions\Admin\Catalog\UpdateModCategory;
use App\Enums\ModFieldType;
use App\Http\Controllers\Admin\Catalog\Requests\CategoryRequest;
use App\Http\Controllers\Admin\Catalog\Support\Refusals;
use App\Http\Controllers\Controller;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\ModCategorySchemaVersion;
use App\Models\Modification;
use App\Services\Catalog\FieldData;
use App\Services\Catalog\SchemaVersions;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-15 mod categories (m3.3-contract §2, catalog.view): the list (names DE/EN, icon, sort, active, fields, modifications) and one
 * category with its field schema (each field with the modifications that hold a value in it: what locks key and type and forbids
 * deleting it), the member-form preview and the schema versions (newest first, each the whole schema after that change). Writes:
 * create and edit of the category (`catalog.manage`); fields are ModFieldsController.
 */
class ModCategoriesController extends Controller
{
    public function index(): Response
    {
        $mods = Modification::withTrashed()->groupBy('category_id')->selectRaw('category_id AS k, COUNT(*) AS c')->toBase()->pluck('c', 'k')->all();
        $fields = ModCategoryField::query()->groupBy('category_id')
            ->selectRaw('category_id, SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS live, SUM(CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END) AS archived')
            ->toBase()->get()->keyBy('category_id');

        return Inertia::render('Catalog/ModCategories', [
            'categories' => array_values(ModCategory::query()->orderBy('sort')->orderBy('id')->get()->map(fn (ModCategory $category): array => [
                ...self::category($category),
                'fields' => (int) ($fields[$category->getKey()]->live ?? 0),
                'archived_fields' => (int) ($fields[$category->getKey()]->archived ?? 0),
                'mods' => (int) ($mods[$category->getKey()] ?? 0),
            ])->all()),
        ]);
    }

    public function show(int $category): Response
    {
        $row = ModCategory::query()->find($category);
        abort_if($row === null, 404);

        $fields = ModCategoryField::query()->where('category_id', $row->getKey())->orderBy('sort')->orderBy('id')->get();
        // One aggregate for every field's "has data" (SF-8 of the M3.3 review).
        $data = FieldData::counts((int) $row->getKey(), array_values($fields->map(fn (ModCategoryField $field): string => (string) $field->getAttribute('key'))->all()));

        return Inertia::render('Catalog/ModCategory', [
            'category' => [
                ...self::category($row),
                'mods' => Modification::withTrashed()->where('category_id', $row->getKey())->count(),
            ],
            'fields' => array_values($fields->map(fn (ModCategoryField $field): array => [
                ...SchemaVersions::field($field),
                'data' => $data[(string) $field->getAttribute('key')] ?? 0,
            ])->all()),
            'versions' => array_values(ModCategorySchemaVersion::query()->with('staff:id,name')->where('category_id', $row->getKey())
                ->orderByDesc('version')->limit(50)->get()
                ->map(fn (ModCategorySchemaVersion $version): array => [
                    'id' => (int) $version->getKey(),
                    'version' => $version->version,
                    'created_at' => $version->created_at?->toIso8601String(),
                    'staff' => $version->getRelationValue('staff')?->getAttribute('name'),
                    'reason' => $version->reason,
                    'schema' => $version->schema,
                ])->all()),
            'types' => array_map(fn (ModFieldType $type): string => $type->value, ModFieldType::cases()),
        ]);
    }

    public function store(CategoryRequest $request, CreateModCategory $create): RedirectResponse
    {
        $category = $create->handle($request->staff(), $request->values(), $request->reason());

        return redirect()->route('admin.catalog.categories.show', ['category' => $category->getKey()], 303)->with('success', 'catalog.flash.category_created');
    }

    public function update(CategoryRequest $request, int $category, UpdateModCategory $update): RedirectResponse
    {
        $row = ModCategory::query()->find($category);
        abort_if($row === null, 404);

        return Refusals::answer(function () use ($request, $row, $update): RedirectResponse {
            $update->handle($request->staff(), $row, $request->values(), (string) $request->reason());

            return back(303)->with('success', 'catalog.flash.category_updated');
        });
    }

    /**
     * @return array<string, mixed>
     */
    private static function category(ModCategory $category): array
    {
        return [
            'id' => (int) $category->getKey(),
            'key' => $category->key,
            'name' => $category->getTranslations('name'),
            'icon' => $category->getAttribute('icon'),
            'sort' => (int) $category->getAttribute('sort'),
            'active' => (bool) $category->getAttribute('active'),
        ];
    }
}
