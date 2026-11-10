<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Support\BulkTicketStatus;
use App\Actions\Support\CreateSupportTicket;
use App\Enums\SupportTicketStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\FourEyes;
use App\Services\Approvals\RunsRecordByRecord;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * support.bulk_status (ADM-25): a status change for more than 100 tickets. Payload {ids (≤ 500), status}. Runs BulkTicketStatus::execute
 * record by record after the approval committed. The summary names the first 20 references.
 */
final class SetTicketStatusInBulk implements ApprovalHandler, RunsRecordByRecord
{
    public const SUMMARY_NAMES = 20;

    public function __construct(private readonly BulkTicketStatus $bulk) {}

    public function key(): string
    {
        return BulkTicketStatus::EVENT;
    }

    public function atom(): string
    {
        return 'support.reply';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'ids' => ['required', 'array', 'min:1', 'max:'.BulkRunner::MAX_IDS],
            'ids.*' => ['string', 'size:26'],
            'status' => ['required', Rule::enum(SupportTicketStatus::class)],
        ])->validate();
    }

    public function describe(array $payload): array
    {
        $ids = is_array($payload['ids'] ?? null) ? array_values(array_filter($payload['ids'], is_string(...))) : [];
        $shown = array_slice($ids, 0, self::SUMMARY_NAMES);
        $tickets = SupportTicket::query()->whereIn('id', $shown)->get()->keyBy('id');
        $labels = array_map(fn (string $id): string => $tickets->get($id) instanceof SupportTicket ? CreateSupportTicket::reference($tickets->get($id)) : $id, $shown);

        return [
            'title' => 'approvals.support_bulk_status.title',
            'subject_label' => null,
            'lines' => [
                ['label' => 'approvals.support_bulk_status.count', 'after' => (string) count($ids)],
                ['label' => 'approvals.support_bulk_status.status', 'after' => is_string($payload['status'] ?? null) ? $payload['status'] : null],
                ['label' => 'approvals.support_bulk_status.tickets', 'after' => implode(', ', $labels)],
                ...(count($ids) > count($shown) ? [['label' => 'approvals.support_bulk_status.more', 'after' => (string) (count($ids) - count($shown))]] : []),
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, BulkTicketStatus::EVENT);
        /** @var list<string> $ids */
        $ids = $request->payload['ids'];
        $requester = Staff::query()->findOrFail($request->requested_by);
        $status = SupportTicketStatus::from((string) $request->payload['status']);

        $rows = $this->bulk->execute($requester, $approver, $ids, $status, $request->reason);
        $done = count(array_filter($rows, fn (array $row): bool => $row['ok']));

        return ['done' => $done, 'failed' => count($rows) - $done, 'rows' => $rows];
    }
}
