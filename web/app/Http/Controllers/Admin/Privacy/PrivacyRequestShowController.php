<?php

namespace App\Http\Controllers\Admin\Privacy;

use App\Enums\PrivacyReplyTemplate;
use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Controller;
use App\Models\DataExport;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Services\Admin\Members\MemberRecord;
use App\Services\Audit\Audit;
use App\Services\Privacy\PrivacyDeadlines;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-46 GDPR request (m3.6 §1): the request (type and article, requester, received, due with the one extension, status, assignee), the
 * request text, the linked export and erasure approval, the evidence of completion, the template replies (DE/EN) and the steps the viewer
 * may take. Opening it is audited (`privacy.request_viewed`, 06 §1.1: the request text is personal data).
 *
 * One clock (DQ-617): the deadline state and whether the one extension is still open are decided here with the page's clock (QaClock);
 * the extension itself (UpdatePrivacyRequest) always checks the real time. The reply address is shown masked (`reply_to`), and
 * `reply_blocked` says why no reply can be sent: the viewer may not process requests, or there is no address (DQ-618).
 */
class PrivacyRequestShowController extends Controller
{
    public function __invoke(Request $request, string $privacyRequest): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');
        // The member's address decides where a reply goes (replyAddress); it reaches the page only masked.
        $row = PrivacyRequest::query()->with(['member:id,username,email,deleted_at', 'assignee:id,name'])->findOrFail($privacyRequest);
        $now = QaClock::now($request);
        $final = $row->status->isFinal();
        $process = $viewer->can('privacy.process') && ! $final;
        $replyTo = $row->replyAddress();
        $mayReply = $viewer->can('privacy.process');

        Audit::record('privacy.request_viewed', $row, actor: $viewer);

        $export = $row->data_export_id === null ? null : DataExport::query()->find($row->data_export_id);
        $approval = $row->approval;

        return Inertia::render('Privacy/Request', [
            'request' => [
                ...PrivacyPresenter::row($row, $viewer, $now),
                'locale' => $row->locale,
                'details' => $row->details,
                'extended_at' => $row->extended_at?->toIso8601String(),
                'extension_reason' => $row->extension_reason,
                'last_reply_at' => $row->last_reply_at?->toIso8601String(),
                'extended_due_at' => $row->extended_at === null ? PrivacyDeadlines::extended($row->due_at)->toIso8601String() : null,
                'reply_to' => $replyTo === null || $replyTo === '' ? null : MemberRecord::maskEmail($replyTo),
                'evidence' => $final ? [
                    'note' => $row->evidence_note,
                    'file' => $row->evidence_name,
                    'download' => $row->evidence_path !== null ? route('admin.privacy.requests.evidence', ['privacyRequest' => $row->id]) : null,
                ] : null,
                'export' => $export === null ? null : ['status' => $export->status->value, 'requested_at' => $export->requested_at?->toIso8601String()],
                'approval' => $approval === null ? null : ['id' => $approval->id, 'status' => $approval->status->value],
            ],
            'templates' => array_map(fn (PrivacyReplyTemplate $template): array => [
                'key' => $template->value,
                'available' => match ($template) {
                    PrivacyReplyTemplate::Extension => $row->extended_at !== null,
                    PrivacyReplyTemplate::Rejected => $row->status === PrivacyRequestStatus::Rejected,
                    default => true,
                },
            ], PrivacyReplyTemplate::cases()),
            'assignees' => fn (): array => $process ? PrivacyPresenter::assignees() : [],
            'activity' => fn (): array => ActivityFeed::for(['privacy_request' => [$row->id]], $viewer),
            'can' => [
                'process' => $process,
                'reply' => $mayReply && $replyTo !== null && $replyTo !== '',
                'reply_blocked' => match (true) {
                    ! $mayReply => 'permission',
                    $replyTo === null || $replyTo === '' => $row->user_id !== null ? 'no_member_address' : 'no_address',
                    default => null,
                },
                'extend' => $process && $row->extended_at === null && $row->due_at->greaterThan($now),
                'export' => $process && $row->type->usesExport() && $row->user_id !== null,
                'erasure' => $process && $row->type === PrivacyRequestType::Erasure && $row->user_id !== null && $viewer->can('members.delete') && $row->approval_request_id === null,
            ],
        ]);
    }
}
