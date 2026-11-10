<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Members\BulkMemberAction;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\ChecksPayloadAtoms;
use App\Services\Approvals\Concerns\NamesAMember;
use App\Services\Approvals\FourEyes;
use App\Services\Approvals\RunsRecordByRecord;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * members.bulk (ADM-09, ADR-214): a member bulk action over more than 100 members, or an export or deletion at any count. Payload
 * {action: restrict|revoke_sessions|export|delete, ids: list<ULID> (≤ 500), options}. Requester and approver hold members.view and the
 * action's own atom (ChecksPayloadAtoms). Executes BulkMemberAction::execute record by record after the approval committed
 * (RunsRecordByRecord, SF-3); the result carries the per-record rows. The summary names the first SUMMARY_NAMES members and how many
 * more (SEC-P3-08), so the approver sees whom it touches.
 */
final class BulkMembers implements ApprovalHandler, ChecksPayloadAtoms, RunsRecordByRecord
{
    public const SUMMARY_NAMES = 20;

    use NamesAMember;

    public function __construct(private readonly BulkMemberAction $bulk) {}

    public function key(): string
    {
        return 'members.bulk';
    }

    public function atom(): string
    {
        return 'members.view';
    }

    public function atomsFor(array $payload): array
    {
        $action = $payload['action'] ?? null;

        return is_string($action) && isset(BulkMemberAction::ATOMS[$action]) ? [BulkMemberAction::ATOMS[$action]] : [];
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'action' => ['required', Rule::in(BulkMemberAction::ACTIONS)],
            'ids' => ['required', 'array', 'min:1', 'max:'.BulkRunner::MAX_IDS],
            'ids.*' => ['string', 'size:26'],
            'options' => ['present', 'array'],
        ])->validate();

        /** @var array<string, mixed> $options */
        $options = $payload['options'];
        BulkMemberAction::validate((string) $payload['action'], $options);
    }

    public function describe(array $payload): array
    {
        $ids = is_array($payload['ids'] ?? null) ? array_values(array_filter($payload['ids'], is_string(...))) : [];
        $shown = array_slice($ids, 0, self::SUMMARY_NAMES);
        $names = User::withTrashed()->whereIn('id', $shown)->pluck('username', 'id');
        $labels = array_map(fn (string $id): string => is_string($names[$id] ?? null) ? '@'.$names[$id] : $id, $shown);

        return [
            'title' => 'approvals.members_bulk.title',
            'subject_label' => null,
            'lines' => [
                ['label' => 'approvals.members_bulk.action', 'after' => is_string($payload['action'] ?? null) ? $payload['action'] : null],
                ['label' => 'approvals.members_bulk.count', 'after' => (string) count($ids)],
                ['label' => 'approvals.members_bulk.members', 'after' => implode(', ', $labels)],
                ...(count($ids) > count($shown) ? [['label' => 'approvals.members_bulk.more', 'after' => (string) (count($ids) - count($shown))]] : []),
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'members.bulk');
        $payload = $request->payload;
        /** @var list<string> $ids */
        $ids = $payload['ids'];
        /** @var array<string, mixed> $options */
        $options = $payload['options'];

        $rows = $this->bulk->execute($this->requester($request), $approver, (string) $payload['action'], $ids, $request->reason, $options);
        $done = count(array_filter($rows, fn (array $row): bool => $row['ok']));

        return ['done' => $done, 'failed' => count($rows) - $done, 'rows' => $rows];
    }
}
