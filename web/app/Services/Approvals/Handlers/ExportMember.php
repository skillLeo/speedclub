<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Members\ExportMemberData;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Concerns\NamesAMember;
use App\Services\Approvals\FourEyes;

/**
 * members.export (06_ADMIN_SPEC §2 four-eyes list, ADM-10): payload {member_id}, subject the member. Executes ExportMemberData; the
 * result names the export, which the requester downloads for 24 hours once it is built (DownloadMemberExport).
 */
final class ExportMember implements ApprovalHandler
{
    use NamesAMember;

    public function __construct(private readonly ExportMemberData $export) {}

    public function key(): string
    {
        return 'members.export';
    }

    public function atom(): string
    {
        return 'members.export';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        $this->validateMember($payload);
    }

    public function describe(array $payload): array
    {
        return [
            'title' => 'approvals.members_export.title',
            'subject_label' => $this->memberLabel($payload),
            'lines' => [['label' => 'approvals.members_export.contents', 'after' => 'set_12']],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'members.export');
        $member = $this->validateMember($request->payload);
        $export = $this->export->handle($this->requester($request), $approver, $member, $request->reason);

        return ['member_id' => $member->id, 'export_id' => $export->id];
    }
}
