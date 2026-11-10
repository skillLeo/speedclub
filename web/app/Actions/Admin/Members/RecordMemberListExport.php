<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Support\Facades\DB;

/**
 * ADM-09 "CSV" (masked addresses only, SEC-P3-03): audits `member.list_exported` with the filter and the row count before the
 * controller streams the file.
 */
class RecordMemberListExport
{
    /**
     * @param  array<string, string>  $filter
     */
    public function handle(Staff $staff, array $filter, int $rows): void
    {
        // ADR-232 / MF-1: a list CSV is an export, so lists.export besides members.view, checked again behind the route.
        StaffAtoms::ensure($staff, 'members.view', 'lists.export');

        DB::transaction(fn () => Audit::record(AdminMemberEvent::ListExported->value, null, after: ['filter' => $filter, 'rows' => $rows, 'email' => 'masked'], actor: $staff));
    }
}
