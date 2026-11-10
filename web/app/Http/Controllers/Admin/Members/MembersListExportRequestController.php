<?php

namespace App\Http\Controllers\Admin\Members;

use App\Actions\Admin\Members\RequestMemberListExport;
use App\Http\Controllers\Admin\Members\Requests\ListExportRequest;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;

/**
 * ADM-09 "CSV mit E-Mail-Adressen" (SEC-P3-03, m3.2-contract ADM-09 row): never the file itself, only an approval request for the
 * four-eyes handler `members.list_export` with the current filter and sort (RequestMemberListExport counts the rows for the summary);
 * the requester downloads the file from ADM-08 / ADM-43 through the signed approval download once a second staff member approved.
 */
class MembersListExportRequestController extends Controller
{
    public const HANDLER = 'members.list_export';

    public function __invoke(ListExportRequest $request, RequestMemberListExport $export): RedirectResponse
    {
        /** @var array<string, mixed> $filter */
        $filter = $request->validated('filter', []);
        $sort = $request->validated('sort');

        $approval = $export->handle($request->staff(), $filter, is_string($sort) && $sort !== '' ? $sort : MemberListQuery::DEFAULT_SORT, $request->reason());

        return back(303)->with('approval', ApprovalsGateway::flash($approval));
    }
}
