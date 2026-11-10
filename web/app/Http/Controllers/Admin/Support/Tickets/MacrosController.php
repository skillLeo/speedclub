<?php

namespace App\Http\Controllers\Admin\Support\Tickets;

use App\Actions\Admin\Support\DeleteSupportMacro;
use App\Actions\Admin\Support\SaveSupportMacro;
use App\Http\Controllers\Admin\Support\Tickets\Requests\SupportMacroRequest;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\SupportMacro;
use App\Services\Support\SupportMacros;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** ADM-27 reply macros DE/EN (`support.view` to read, `support.macros` to edit). */
class MacrosController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Support/Macros', ['macros' => SupportMacros::all(), 'variables' => SupportMacros::VARIABLES]);
    }

    public function store(SupportMacroRequest $request, SaveSupportMacro $save): RedirectResponse
    {
        $save->handle(self::staff($request), null, $request->payload());

        return back(303)->with('success', 'support.flash.macro_saved');
    }

    public function update(SupportMacroRequest $request, string $macro, SaveSupportMacro $save): RedirectResponse
    {
        $save->handle(self::staff($request), self::find($macro), $request->payload());

        return back(303)->with('success', 'support.flash.macro_saved');
    }

    public function destroy(Request $request, string $macro, DeleteSupportMacro $delete): RedirectResponse
    {
        $delete->handle(self::staff($request), self::find($macro));

        return back(303)->with('success', 'support.flash.macro_deleted');
    }

    private static function find(string $id): SupportMacro
    {
        $row = SupportMacro::query()->find(strtolower($id));
        abort_if($row === null, 404);

        return $row;
    }

    private static function staff(Request $request): Staff
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $staff;
    }
}
