<?php

namespace App\Services\Privacy;

use App\Enums\AuditActorType;
use App\Enums\MemberSecurityEvent;
use App\Enums\PrivacyRequestStatus;
use App\Models\AuditEvent;
use App\Models\PrivacyRequest;
use Carbon\CarbonImmutable;

/**
 * Reads for ADM-45 and the ADM-06 queue "DSGVO-Fristen ≤ 7 Tage" (m3.6 §1).
 */
final class PrivacyRequests
{
    /**
     * Open requests due within speedclub.privacy.due_soon_days (overdue ones included): count, status (danger when one is overdue) and the
     * earliest due date as `since`. The shape of Kpi::queues().
     *
     * @return array{count: int, status: 'ok'|'warning'|'danger', since: string|null}
     */
    public function dueQueue(): array
    {
        $row = PrivacyRequest::query()
            ->whereIn('status', array_map(fn (PrivacyRequestStatus $status): string => $status->value, PrivacyRequestStatus::openStates()))
            ->where('due_at', '<=', now()->addDays(config()->integer('speedclub.privacy.due_soon_days')))
            ->toBase()
            ->selectRaw('COUNT(*) AS due_count, MIN(due_at) AS earliest')
            ->first();

        $count = (int) ($row->due_count ?? 0);
        $earliest = is_string($row?->earliest) ? CarbonImmutable::parse($row->earliest, 'UTC') : null;

        return [
            'count' => $count,
            'status' => $count === 0 ? 'ok' : ($earliest !== null && $earliest->isPast() ? 'danger' : 'warning'),
            'since' => $earliest?->toIso8601String(),
        ];
    }

    /**
     * Members' own SET-12 exports and SET-13 deletions, read-only, newest first: completed self-service requests (the member got the
     * export link by mail; the deletion ran at once and is completed by accounts:prune). From the audit log, which keeps them after the
     * account is gone.
     *
     * @return list<array{kind: 'export'|'erasure', member_id: string|null, requested_at: string, status: 'completed'}>
     */
    public function selfService(int $limit = 100): array
    {
        $kinds = [
            MemberSecurityEvent::DataExportRequested->value => 'export',
            MemberSecurityEvent::DeletionRequested->value => 'erasure',
        ];

        $rows = [];
        $events = AuditEvent::query()
            ->whereIn('action', array_keys($kinds))
            ->where('actor_type', AuditActorType::Member->value)
            ->orderByDesc('occurred_at')
            ->limit(max(1, min(500, $limit)))
            ->get(['action', 'target_id', 'occurred_at']);

        foreach ($events as $event) {
            $rows[] = [
                'kind' => $kinds[(string) $event->getAttribute('action')] === 'export' ? 'export' : 'erasure',
                'member_id' => is_string($event->getAttribute('target_id')) ? $event->getAttribute('target_id') : null,
                'requested_at' => CarbonImmutable::parse($event->getAttribute('occurred_at'), 'UTC')->toIso8601String(),
                'status' => 'completed',
            ];
        }

        return $rows;
    }
}
