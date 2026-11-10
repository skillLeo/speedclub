<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Actions\Admin\Catalog\ArchiveModField;
use App\Actions\Admin\Catalog\CreateModField;
use App\Actions\Admin\Catalog\DeleteModField;
use App\Actions\Admin\Catalog\ReorderModFields;
use App\Actions\Admin\Catalog\UpdateModField;
use App\Http\Controllers\Admin\Catalog\Requests\ArchiveRequest;
use App\Http\Controllers\Admin\Catalog\Requests\FieldRequest;
use App\Http\Controllers\Admin\Catalog\Requests\ReasonedCatalogRequest;
use App\Http\Controllers\Admin\Catalog\Requests\ReorderRequest;
use App\Http\Controllers\Admin\Catalog\Support\Refusals;
use App\Http\Controllers\Controller;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use Illuminate\Http\RedirectResponse;

/**
 * ADM-15 field editor (m3.3 §1, all `catalog.manage` with a reason; each save is one schema version): add, edit (key and type lock
 * once the field has data, narrowing is refused with the count), reorder, archive / restore, delete (⚿, only without data).
 */
class ModFieldsController extends Controller
{
    public function store(FieldRequest $request, int $category, CreateModField $create): RedirectResponse
    {
        $row = $this->category($category);

        return Refusals::answer(function () use ($request, $row, $create): RedirectResponse {
            $create->handle($request->staff(), $row, $request->values(), (string) $request->reason());

            return back(303)->with('success', 'catalog.flash.field_created');
        });
    }

    public function update(FieldRequest $request, int $field, UpdateModField $update): RedirectResponse
    {
        $row = $this->field($field);

        return Refusals::answer(function () use ($request, $row, $update): RedirectResponse {
            $update->handle($request->staff(), $row, $request->values(), (string) $request->reason());

            return back(303)->with('success', 'catalog.flash.field_updated');
        });
    }

    public function reorder(ReorderRequest $request, int $category, ReorderModFields $reorder): RedirectResponse
    {
        $row = $this->category($category);

        return Refusals::answer(function () use ($request, $row, $reorder): RedirectResponse {
            $reorder->handle($request->staff(), $row, $request->ids(), (string) $request->reason());

            return back(303)->with('success', 'catalog.flash.fields_reordered');
        });
    }

    public function archive(ArchiveRequest $request, int $field, ArchiveModField $archive): RedirectResponse
    {
        $row = $this->field($field);
        $archived = $request->boolean('archived');

        return Refusals::answer(function () use ($request, $row, $archive, $archived): RedirectResponse {
            $archive->handle($request->staff(), $row, $archived, (string) $request->reason());

            return back(303)->with('success', $archived ? 'catalog.flash.field_archived' : 'catalog.flash.field_restored');
        });
    }

    public function destroy(ReasonedCatalogRequest $request, int $field, DeleteModField $delete): RedirectResponse
    {
        $row = $this->field($field);

        return Refusals::answer(function () use ($request, $row, $delete): RedirectResponse {
            $delete->handle($request->staff(), $row, (string) $request->reason());

            return back(303)->with('success', 'catalog.flash.field_deleted');
        });
    }

    private function category(int $id): ModCategory
    {
        $row = ModCategory::query()->find($id);
        abort_if($row === null, 404);

        return $row;
    }

    private function field(int $id): ModCategoryField
    {
        $row = ModCategoryField::query()->find($id);
        abort_if($row === null, 404);

        return $row;
    }
}
