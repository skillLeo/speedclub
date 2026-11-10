<?php

namespace App\Http\Controllers\Admin\Audit;

use App\Actions\Admin\Audit\RequestAuditExport;
use App\Http\Controllers\Admin\Audit\Requests\RequestAuditExportRequest;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\RedirectResponse;

/** ADM-44 export button: creates an approval request (four-eyes), never the export itself. */
class AuditExportController extends Controller
{
    public function __invoke(RequestAuditExportRequest $request, RequestAuditExport $export): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        /** @var array<string, string|null> $filter */
        $filter = $request->validated('filter', []);

        $approval = $export($staff, $request->string('format')->value(), $filter, $request->string('reason')->value());

        return back(303)->with('approval', ApprovalsGateway::flash($approval));
    }
}
