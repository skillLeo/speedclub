<?php

namespace App\Http\Controllers\Staff;

use App\Enums\ApprovalEvent;
use App\Enums\ApprovalStatus;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\Approvals;
use App\Services\Audit\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * GET /admin/approvals/download?approval=… (signed, from Approvals::downloadUrl): the file an approved export wrote (audit.export,
 * members.list_export), for its requester only, while the download window lasts and the requester still holds the action's atoms.
 * Every download is audited. Anything else is 404, so the link tells nobody else that the file exists. Never cached anywhere
 * (`no-store, private`, SF-6), always an attachment, never sniffed.
 */
class ApprovalDownloadController extends Controller
{
    private const NAMES = [
        'audit.export' => 'speedclub-audit-',
        'members.list_export' => 'speedclub-mitglieder-',
    ];

    public function __invoke(Request $request, Approvals $approvals): StreamedResponse
    {
        $id = $request->query('approval');
        $approval = is_string($id) ? ApprovalRequest::query()->find($id) : null;
        abort_unless($approval instanceof ApprovalRequest, 404);

        $staff = $request->user('staff');
        $file = Approvals::downloadableFile($approval);
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));

        abort_unless(
            $staff instanceof Staff
            && $approval->status === ApprovalStatus::Executed
            && $approval->requested_by === $staff->getKey()
            && isset(self::NAMES[$approval->action])
            && $approvals->requesterMayStillUse($approval, $staff)
            && $file !== null
            && $disk->exists($file),
            404,
        );

        Audit::record(ApprovalEvent::ExportDownloaded->value, $approval, after: ['action' => $approval->action], actor: $staff);

        $format = pathinfo($file, PATHINFO_EXTENSION);

        return $disk->download($file, self::NAMES[$approval->action].$approval->executed_at?->format('Ymd-His').'.'.$format, [
            'Content-Type' => $format === 'csv' ? 'text/csv; charset=UTF-8' : 'application/x-ndjson; charset=UTF-8',
            'Cache-Control' => 'no-store, private',
            'Pragma' => 'no-cache',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
