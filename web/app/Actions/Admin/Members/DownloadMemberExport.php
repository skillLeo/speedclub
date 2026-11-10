<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Models\DataExport;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\DataExport\BuildDataExport;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * A staff export's download (ADM-10, `members.export`): only the staff member who asked for it, while it is ready and inside its 24 hours
 * (BuildDataExport sets expires_at). Each download is audited `member.export_downloaded`. Returns the path on the `local` disk; the
 * admin controller streams it with no-store. Null when it is not (or no longer) there; AuthorizationException for anybody else.
 *
 * @throws AuthorizationException
 */
class DownloadMemberExport
{
    public function handle(Staff $staff, DataExport $export): ?string
    {
        StaffAtoms::ensure($staff, 'members.export');

        if (! $export->isForStaff() || $export->requested_by_staff_id !== $staff->getKey()) {
            throw new AuthorizationException;
        }

        $path = BuildDataExport::zipPath($export);

        if (! $export->isDownloadable() || ! Storage::disk('local')->exists($path)) {
            return null;
        }

        DB::transaction(function () use ($staff, $export): void {
            $member = User::withTrashed()->find($export->user_id);
            Audit::record(AdminMemberEvent::ExportDownloaded->value, $member ?? $export, after: ['export_id' => $export->id], actor: $staff);
        });

        return $path;
    }
}
