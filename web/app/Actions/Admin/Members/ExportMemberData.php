<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Enums\DataExportStatus;
use App\Models\DataExport;
use App\Models\Staff;
use App\Models\User;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\DataExport\BuildDataExport;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The executor of the four-eyes `members.export` (and of a `members.bulk` export), refused unless Approvals::approve() is executing
 * such a request naming this member (FourEyes, MF-1): the SET-12 export ZIP of the
 * member, built by the same restartable jobs (BuildDataExport, ADR-203 e) on the private disk, for the requester
 * (data_exports.requested_by_staff_id): never listed in the member's SET-12, never mailed to them, not counted against their 24-hour
 * cooldown, downloadable by the requester for 24 hours once ready (DownloadMemberExport). Audited with requester and approver. It is
 * the staff copy (SEC-P3-01): no message text, chat photo or reaction of anybody, conversation metadata only (ExportContents).
 *
 * @throws AuthorizationException|DomainException for an account that has nothing to export
 */
class ExportMemberData
{
    public function handle(Staff $requester, Staff $approver, User $member, string $reason): DataExport
    {
        FourEyes::member(FourEyes::executor(['members.export', 'members.bulk'], $requester, $approver, 'members.export'), $member, 'export');

        if (! BuildDataExport::ownerMayExport($member)) {
            throw new DomainException('This account has nothing to export.');
        }

        return DB::transaction(function () use ($requester, $approver, $member, $reason): DataExport {
            $export = new DataExport;
            $export->forceFill([
                'user_id' => $member->id,
                'requested_by_staff_id' => $requester->getKey(),
                'status' => DataExportStatus::Queued,
                'requested_at' => now(),
            ])->save();

            Audit::record(AdminMemberEvent::ExportRequested->value, $member, after: [
                'export_id' => $export->id,
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver->getKey(),
            ], reason: $reason, actor: $approver);

            BuildDataExport::dispatch($export->id)->afterCommit();

            return $export;
        });
    }
}
