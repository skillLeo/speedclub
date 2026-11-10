<?php

namespace App\Http\Controllers\Admin\Support\Tickets;

use App\Actions\Admin\Support\BulkTicketStatus;
use App\Enums\SupportTicketStatus;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Admin\Support\Tickets\Requests\TicketBulkRequest;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;

/** ADM-25 bulk status (≤ 500; above 100 in 24 h one approval request, `support.bulk_status`). */
class TicketsBulkController extends Controller
{
    public const FLASH = 'support_bulk';

    public function __invoke(TicketBulkRequest $request, BulkTicketStatus $bulk): RedirectResponse
    {
        $outcome = $bulk->handle($request->staff(), (array) $request->validated('ids'), SupportTicketStatus::from($request->string('status')->value()), $request->reason());

        if ($outcome->approval !== null) {
            return back(303)->with('approval', ApprovalsGateway::flash($outcome->approval));
        }

        $back = back(303)->with(self::FLASH, ['rows' => $outcome->rows]);

        return $outcome->counts()['failed'] === 0 ? $back->with('success', 'support.flash.bulk_done') : $back->with('error', 'support.flash.bulk_partial');
    }
}
