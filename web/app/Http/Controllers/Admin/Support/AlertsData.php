<?php

namespace App\Http\Controllers\Admin\Support;

use App\Console\Commands\AuditVerifyCommand;
use App\Enums\ApprovalStatus;
use App\Enums\CaseStatus;
use App\Models\ApprovalRequest;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Support\PiiReveals;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;

/**
 * ADM-08 staff alerts and the shell's alert badge: approvals waiting for this staff member, open cases assigned to them and
 * system warnings they are allowed to act on.
 */
class AlertsData
{
    public function __construct(
        private readonly ApprovalsGateway $approvals,
        private readonly DashboardData $dashboard,
    ) {}

    public function approvalCount(Staff $staff): int
    {
        return $staff->can('approvals.decide') ? $this->approvals->pendingCount($staff) : 0;
    }

    /**
     * @return list<array{id: string, action: string, title: string, subject_label: string|null, requested_by: string, reason: string, expires_at: string}>
     */
    public function approvals(Staff $staff): array
    {
        return $staff->can('approvals.decide') ? $this->approvals->pendingFor($staff) : [];
    }

    /**
     * M3.4: approved requests still running (status executing: a bulk run record by record, ADR-229) that this staff member asked for or
     * approved, so a long run is visible while it lasts.
     *
     * @return list<array{id: string, action: string, title: string, subject_label: string|null, started_at: string|null, mine: bool}>
     */
    public function running(Staff $staff): array
    {
        return array_values(ApprovalRequest::query()
            ->where('status', ApprovalStatus::Executing)
            ->where(fn (Builder $q) => $q->where('requested_by', $staff->getKey())->orWhere('decided_by', $staff->getKey()))
            ->orderByDesc('decided_at')->orderByDesc('id')->limit(20)->get()
            ->map(fn (ApprovalRequest $request): array => [
                'id' => $request->id,
                'action' => $request->action,
                'title' => $request->summary['title'],
                'subject_label' => $request->summary['subject_label'] ?? null,
                'started_at' => $request->decided_at?->toIso8601String(),
                'mine' => $request->requested_by === $staff->getKey(),
            ])->all());
    }

    /**
     * @return list<array{id: string, action: string, title: string, url: string, until: string}>
     */
    public function downloads(Staff $staff): array
    {
        return $this->approvals->downloadsFor($staff);
    }

    public function assignedCaseCount(Staff $staff): int
    {
        return $staff->can('moderation.view') ? $this->assignedCases($staff)->count() : 0;
    }

    /**
     * @return list<array{id: string, target_type: string, status: string, priority: int, report_count: int, created_at: string|null}>
     */
    public function cases(Staff $staff): array
    {
        if (! $staff->can('moderation.view')) {
            return [];
        }

        return array_values($this->assignedCases($staff)
            ->orderByDesc('priority')
            ->oldest()
            ->limit(50)
            ->get(['id', 'target_type', 'status', 'priority', 'report_count', 'created_at'])
            ->map(fn (ModerationCase $case): array => [
                'id' => $case->id,
                'target_type' => $case->target_type->value,
                'status' => $case->status->value,
                'priority' => $case->priority,
                'report_count' => $case->report_count,
                'created_at' => $case->created_at?->toIso8601String(),
            ])
            ->all());
    }

    /**
     * Warnings as i18n keys of the alerts module, newest problem first.
     *
     * @return list<array{key: string, tone: 'warning'|'danger', since: string|null, atom: string}>
     */
    public function systemWarnings(Staff $staff): array
    {
        $warnings = [];

        if ($staff->can('audit.view') || $staff->can('system.view')) {
            $verification = Cache::get(AuditVerifyCommand::RESULT_CACHE_KEY);

            if (is_array($verification) && ($verification['intact'] ?? true) === false) {
                $warnings[] = [
                    'key' => 'audit_chain_broken',
                    'tone' => 'danger',
                    'since' => is_string($verification['verified_at'] ?? null) ? $verification['verified_at'] : null,
                    'atom' => 'audit.view',
                ];
            }
        }

        // SEC-P3-21: a staff member reached today's cap of address reveals.
        if ($staff->can('audit.view') && PiiReveals::limitReachedToday()) {
            $warnings[] = ['key' => 'pii_reveal_limit', 'tone' => 'warning', 'since' => null, 'atom' => 'audit.view'];
        }

        if ($staff->can('system.view')) {
            foreach ($this->dashboard->queues($staff) as $key => $queue) {
                $status = $queue['status'];

                if (in_array($key, ['failed_jobs', 'scheduler', 'queue'], true) && $status !== 'ok') {
                    $warnings[] = [
                        'key' => $key,
                        'tone' => $status,
                        'since' => $queue['since'] ?? null,
                        'atom' => 'system.view',
                    ];
                }
            }
        }

        return $warnings;
    }

    /**
     * @return Builder<ModerationCase>
     */
    private function assignedCases(Staff $staff): Builder
    {
        return ModerationCase::query()
            ->where('assigned_staff_id', $staff->id)
            ->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value]);
    }
}
