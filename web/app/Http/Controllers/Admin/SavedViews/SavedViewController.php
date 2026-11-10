<?php

namespace App\Http\Controllers\Admin\SavedViews;

use App\Actions\Admin\Overview\DeleteTableView;
use App\Actions\Admin\Overview\SaveTableView;
use App\Http\Controllers\Admin\SavedViews\Requests\StoreSavedViewRequest;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class SavedViewController extends Controller
{
    public function store(StoreSavedViewRequest $request, SaveTableView $saveView): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        /** @var array<string, mixed> $query */
        $query = $request->validated('query');

        $saveView($staff, $request->string('table')->value(), trim($request->string('name')->value()), $query);

        return back(303)->with('success', 'ui.table.views.saved');
    }

    public function destroy(Request $request, string $view, DeleteTableView $deleteView): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        // Someone else's view answers exactly like a missing one.
        abort_unless($deleteView($staff, $view), 404);

        return back(303)->with('success', 'ui.table.views.deleted');
    }
}
