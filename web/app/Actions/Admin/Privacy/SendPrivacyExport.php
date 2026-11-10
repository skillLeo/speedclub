<?php

namespace App\Actions\Admin\Privacy;

use App\Enums\DataExportStatus;
use App\Enums\PrivacyEvent;
use App\Enums\PrivacyRequestStatus;
use App\Models\DataExport;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\DataExport\BuildDataExport;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-46 for an Auskunft or Export of a member (`privacy.process`; m3.6 §1 "Export reuses SET-12"): the member's own SET-12 export, built
 * by the same jobs (BuildDataExport) and mailed to the member's account address with its signed 7-day link, listed in their SET-12 as
 * usual. Staff never get the file (that is the four-eyes `members.export`): the team only proves identity first. Not while the
 * request's previous export is still queued, running or downloadable.
 *
 * @throws AuthorizationException|TeamRefused
 */
class SendPrivacyExport
{
    public function handle(Staff $by, PrivacyRequest $request): DataExport
    {
        StaffAtoms::ensure($by, 'privacy.process');

        if ($request->status->isFinal()) {
            throw new TeamRefused('final');
        }

        if (! $request->type->usesExport()) {
            throw new TeamRefused('wrong_type');
        }

        $member = $request->user_id === null ? null : User::withTrashed()->find($request->user_id);

        if (! $member instanceof User) {
            throw new TeamRefused('no_member');
        }

        if (! BuildDataExport::ownerMayExport($member)) {
            throw new TeamRefused('nothing_to_export');
        }

        return DB::transaction(function () use ($by, $request, $member): DataExport {
            $locked = PrivacyRequest::query()->whereKey($request->getKey())->lockForUpdate()->firstOrFail();
            $previous = $locked->data_export_id === null ? null : DataExport::query()->find($locked->data_export_id);

            if ($previous !== null && in_array($previous->status, [DataExportStatus::Queued, DataExportStatus::Running, DataExportStatus::Ready], true)
                && ($previous->expires_at === null || $previous->expires_at->isFuture())) {
                throw new TeamRefused('export_running');
            }

            $export = new DataExport;
            $export->forceFill(['user_id' => $member->id, 'status' => DataExportStatus::Queued, 'requested_at' => now()])->save();

            $locked->forceFill([
                'data_export_id' => $export->id,
                'status' => $locked->status === PrivacyRequestStatus::Open ? PrivacyRequestStatus::InProgress : $locked->status,
            ])->save();
            $request->setRawAttributes($locked->getAttributes(), true);

            Audit::record(PrivacyEvent::ExportSent->value, $locked, after: ['export_id' => $export->id, 'member_id' => $member->id], actor: $by);

            BuildDataExport::dispatch($export->id)->afterCommit();

            return $export;
        });
    }
}
