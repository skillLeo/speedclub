<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Actions\Admin\Moderation\DeleteSorTemplate;
use App\Actions\Admin\Moderation\SaveSorTemplate;
use App\Http\Controllers\Admin\Moderation\Requests\SorTemplateRequest;
use App\Http\Controllers\Controller;
use App\Models\SorTemplate;
use App\Models\Staff;
use App\Services\Moderation\SorTemplates;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-24 statement-of-reasons templates DE/EN (`moderation.view` to read, `moderation.templates` to edit): per key and language, the
 * action, facts with placeholders, ground and where it is written; the redress text is fixed by law and only shown.
 */
class TemplatesController extends Controller
{
    public function index(Request $request): Response
    {
        return Inertia::render('Moderation/Templates', [
            'templates' => SorTemplates::all(),
            'placeholders' => SorTemplates::PLACEHOLDERS,
        ]);
    }

    public function store(SorTemplateRequest $request, SaveSorTemplate $save): RedirectResponse
    {
        $save->handle(self::staff($request), null, $request->payload());

        return back(303)->with('success', 'moderation.flash.template_saved');
    }

    public function update(SorTemplateRequest $request, string $template, SaveSorTemplate $save): RedirectResponse
    {
        $save->handle(self::staff($request), self::find($template), $request->payload());

        return back(303)->with('success', 'moderation.flash.template_saved');
    }

    public function destroy(Request $request, string $template, DeleteSorTemplate $delete): RedirectResponse
    {
        $delete->handle(self::staff($request), self::find($template));

        return back(303)->with('success', 'moderation.flash.template_deleted');
    }

    private static function find(string $id): SorTemplate
    {
        $row = SorTemplate::query()->find(strtolower($id));
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
