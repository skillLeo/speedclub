<?php

namespace App\Actions\Admin\Members;

use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\Handlers\ExportMemberList;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-09 "CSV mit E-Mail-Adressen" (SEC-P3-03): asks for the four-eyes `members.list_export` of the current filter and sort, with the
 * number of members it matches now (the approver sees it). The plain list CSV stays masked. Never writes a file here.
 *
 * @throws AuthorizationException|ValidationException
 */
class RequestMemberListExport
{
    public function __construct(private readonly Approvals $approvals) {}

    /**
     * @param  array<string, mixed>  $filter  the ADM-09 filter (MemberListQuery::FILTERS)
     */
    public function handle(Staff $staff, array $filter, ?string $sort, string $reason): ApprovalRequest
    {
        StaffAtoms::ensure($staff, 'members.export', 'members.view', 'members.view_pii');

        $filter = array_filter($filter, fn (mixed $value): bool => is_string($value) && $value !== '');
        $payload = ['filter' => $filter, 'sort' => $sort === '' ? null : $sort, 'rows_at_request' => 0];
        // Validated before the count: the query must not see an unknown filter or sort.
        app(ExportMemberList::class)->validate($payload);
        $payload['rows_at_request'] = ExportMemberList::query($payload, $staff)->count();

        return $this->approvals->request('members.list_export', $payload, $reason, $staff);
    }
}
