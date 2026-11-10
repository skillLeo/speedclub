<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Moderation\BulkNoAction;
use App\Models\ApprovalRequest;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\FourEyes;
use App\Services\Approvals\RunsRecordByRecord;
use Illuminate\Support\Facades\Validator;

/**
 * moderation.bulk_no_action (ADM-20, ADR-214/229): "Keine Maßnahme" for more than 100 cases of a spam wave. Payload {ids: list<ULID>
 * (≤ 500)}. Executes BulkNoAction::execute record by record after the approval committed. The summary names the first 20 cases with
 * their targets and how many more.
 */
final class CloseCasesInBulk implements ApprovalHandler, RunsRecordByRecord
{
    public const SUMMARY_NAMES = 20;

    public function __construct(private readonly BulkNoAction $bulk) {}

    public function key(): string
    {
        return BulkNoAction::EVENT;
    }

    public function atom(): string
    {
        return 'moderation.decide';
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
        ])->validate();
    }

    public function describe(array $payload): array
    {
        $ids = is_array($payload['ids'] ?? null) ? array_values(array_filter($payload['ids'], is_string(...))) : [];
        $shown = array_slice($ids, 0, self::SUMMARY_NAMES);
        $cases = ModerationCase::query()->with('firstReport:id,case_id,target_label')->whereIn('id', $shown)->get()->keyBy('id');
        $labels = array_map(function (string $id) use ($cases): string {
            $case = $cases->get($id);

            return $case instanceof ModerationCase ? strtoupper(substr($case->id, -8)).' '.($case->target_label ?? $case->firstReport->target_label ?? $case->target_type->value) : $id;
        }, $shown);

        return [
            'title' => 'approvals.moderation_bulk_no_action.title',
            'subject_label' => null,
            'lines' => [
                ['label' => 'approvals.moderation_bulk_no_action.count', 'after' => (string) count($ids)],
                ['label' => 'approvals.moderation_bulk_no_action.cases', 'after' => implode(', ', $labels)],
                ...(count($ids) > count($shown) ? [['label' => 'approvals.moderation_bulk_no_action.more', 'after' => (string) (count($ids) - count($shown))]] : []),
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, BulkNoAction::EVENT);
        /** @var list<string> $ids */
        $ids = $request->payload['ids'];
        $requester = Staff::query()->findOrFail($request->requested_by);

        $rows = $this->bulk->execute($requester, $approver, $ids, $request->reason);
        $done = count(array_filter($rows, fn (array $row): bool => $row['ok']));

        return ['done' => $done, 'failed' => count($rows) - $done, 'rows' => $rows];
    }
}
