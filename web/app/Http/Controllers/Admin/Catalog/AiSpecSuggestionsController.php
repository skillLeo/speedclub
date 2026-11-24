<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Actions\Admin\Catalog\DeleteAiSpecSuggestions;
use App\Http\Controllers\Admin\Catalog\Requests\ReasonedCatalogRequest;
use App\Http\Controllers\Controller;
use App\Models\Generation;
use Illuminate\Http\RedirectResponse;

/**
 * M5.9 (m5.9-contract §8, lead D-5): ADM-14 model page, "KI-Herstellerangaben löschen" of one generation (`catalog.manage`, ⚿, reason).
 * The Action deletes the cached AI spec suggestion and audits `catalog.ai_specs_deleted`; when nothing was left (someone else was
 * faster, or it expired and was pruned) the answer says so and nothing is audited.
 */
class AiSpecSuggestionsController extends Controller
{
    public function destroy(ReasonedCatalogRequest $request, int $generation, DeleteAiSpecSuggestions $delete): RedirectResponse
    {
        $row = Generation::query()->find($generation);
        abort_if($row === null, 404);

        $deleted = $delete->handle($request->staff(), $row, (string) $request->reason());

        return back(303)->with('success', $deleted > 0 ? 'catalog.flash.ai_specs_deleted' : 'catalog.flash.ai_specs_none');
    }
}
