<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Actions\Admin\Moderation\BulkNoAction;
use App\Http\Controllers\Admin\Moderation\Requests\BulkNoActionRequest;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;

/** ADM-20 bulk "Keine Maßnahme" (≤ 500; above 100 in 24 h one approval request, `moderation.bulk_no_action`). */
class ReportsBulkController extends Controller
{
    public const FLASH = 'moderation_bulk';

    public function __invoke(BulkNoActionRequest $request, BulkNoAction $bulk): RedirectResponse
    {
        $outcome = $bulk->handle($request->staff(), (array) $request->validated('ids'), $request->reason());

        if ($outcome->approval !== null) {
            return back(303)->with('approval', ApprovalsGateway::flash($outcome->approval));
        }

        $back = back(303)->with(self::FLASH, ['rows' => $outcome->rows]);

        return $outcome->counts()['failed'] === 0 ? $back->with('success', 'moderation.flash.bulk_done') : $back->with('error', 'moderation.flash.bulk_partial');
    }
}
