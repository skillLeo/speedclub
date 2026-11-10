<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Enums\CaseStatus;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\Staff;
use App\Services\Moderation\CasePriority;
use App\Services\Moderation\CaseRecord;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\AllowedSort;
use Spatie\QueryBuilder\Enums\SortDirection;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-20 (and ADM-22's message cases) queue: whitelisted filters and sorts over the cases of one tab, the priority with its parts
 * (CasePriority), a deterministic order (the id breaks every tie). Rows name the target by type and label, never message content.
 */
final class CaseListQuery
{
    public const TABS = ['new', 'in_review', 'decided'];

    public const FILTERS = ['q', 'target_type', 'reason', 'assigned', 'source'];

    /**
     * @return QueryBuilder<ModerationCase>
     */
    public static function build(Request $request, Staff $staff, string $tab, CarbonImmutable $now, bool $messagesOnly = false): QueryBuilder
    {
        $base = CaseRecord::query($now)
            ->with(['assignedStaff:id,name', 'firstReport', 'decision:id,case_id,action,decided_at'])
            ->selectSub(Report::query()->selectRaw('max(created_at)')->whereColumn('reports.case_id', 'moderation_cases.id'), 'last_report_at');

        match ($tab) {
            'new' => $base->where('moderation_cases.status', CaseStatus::New->value),
            'in_review' => $base->where('moderation_cases.status', CaseStatus::InReview->value),
            'open' => $base->whereIn('moderation_cases.status', [CaseStatus::New->value, CaseStatus::InReview->value]),
            default => $base->whereIn('moderation_cases.status', [CaseStatus::Decided->value, CaseStatus::Closed->value]),
        };

        if ($messagesOnly) {
            $base->where('moderation_cases.target_type', ReportTargetType::Message->value);
        }

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', fn (Builder $q, mixed $value) => self::text($q, is_string($value) ? $value : ''))->delimiter("\u{1}"),
                AllowedFilter::callback('target_type', function (Builder $q, mixed $value): void {
                    $q->where('moderation_cases.target_type', ReportTargetType::tryFrom(is_string($value) ? $value : '')->value ?? '-');
                })->delimiter("\u{1}"),
                AllowedFilter::callback('reason', function (Builder $q, mixed $value): void {
                    $reason = ReportReason::tryFrom(is_string($value) ? $value : '')->value ?? '-';
                    $q->whereExists(fn ($sub) => $sub->selectRaw('1')->from('reports')->whereColumn('reports.case_id', 'moderation_cases.id')->where('reports.reason', $reason));
                })->delimiter("\u{1}"),
                AllowedFilter::callback('assigned', fn (Builder $q, mixed $value) => match ($value) {
                    'me' => $q->where('moderation_cases.assigned_staff_id', $staff->id),
                    'none' => $q->whereNull('moderation_cases.assigned_staff_id'),
                    'others' => $q->whereNotNull('moderation_cases.assigned_staff_id')->where('moderation_cases.assigned_staff_id', '!=', $staff->id),
                    default => $q,
                })->delimiter("\u{1}"),
                AllowedFilter::callback('source', function (Builder $q, mixed $value): void {
                    match ($value) {
                        // ADR-243 / SF-9 of the M3.3 review: what the row badge calls automated (CaseRecord::automatedDetection).
                        'automated' => $q->where(fn (Builder $w) => $w->where('moderation_cases.automated', true)->orWhere('moderation_cases.ai_detected', true)),
                        'web_form' => $q->whereExists(fn ($sub) => $sub->selectRaw('1')->from('reports')->whereColumn('reports.case_id', 'moderation_cases.id')->where('reports.source', ReportSource::WebForm->value)),
                        'staff' => $q->where('moderation_cases.origin', 'staff'),
                        default => $q,
                    };
                })->delimiter("\u{1}"),
            )
            ->allowedSorts(
                AllowedSort::field('priority', 'priority_score'),
                AllowedSort::field('created_at', 'moderation_cases.created_at'),
                AllowedSort::field('last_report_at', 'last_report_at'),
                AllowedSort::field('reporters', 'moderation_cases.reporter_count'),
                AllowedSort::field('decided_at', 'moderation_cases.decided_at'),
            )
            // An AllowedSort, so the default sorts by the internal column (a string would order by `priority`, the stored base).
            ->defaultSort($tab === 'decided'
                ? AllowedSort::field('decided_at', 'moderation_cases.decided_at')->defaultDirection(SortDirection::Descending)
                : AllowedSort::field('priority', 'priority_score')->defaultDirection(SortDirection::Descending));

        $query->getEloquentBuilder()->orderBy('moderation_cases.id');

        return $query;
    }

    public static function defaultSort(string $tab): string
    {
        return $tab === 'decided' ? '-decided_at' : '-priority';
    }

    /**
     * @param  list<ModerationCase>  $cases
     * @return list<array<string, mixed>>
     */
    public static function rows(array $cases, Staff $staff): array
    {
        $ids = array_map(fn (ModerationCase $case): string => $case->id, $cases);
        $reasons = [];

        foreach (Report::query()->whereIn('case_id', $ids === [] ? ['-'] : $ids)->orderBy('created_at')->orderBy('id')->get(['case_id', 'reason', 'sub_reason', 'source']) as $report) {
            $reasons[$report->case_id][] = $report;
        }

        return array_map(function (ModerationCase $case) use ($reasons, $staff): array {
            $reports = $reasons[$case->id] ?? [];
            $top = null;

            foreach ($reports as $report) {
                $weight = $report->reason->weight($report->sub_reason);
                if ($top === null || $weight > $top[0]) {
                    $top = [$weight, $report];
                }
            }

            $decision = $case->decision;
            $lastReport = $case->getAttribute('last_report_at');

            return [
                'id' => $case->id,
                'reference' => strtoupper(substr($case->id, -8)),
                'status' => $case->status->value,
                'origin' => $case->origin->value,
                'target_type' => $case->target_type->value,
                'target_label' => $case->target_label ?? $case->firstReport?->target_label,
                'reason' => $top === null ? null : $top[1]->reason->value,
                'sub_reason' => $top === null ? null : $top[1]->sub_reason?->value,
                'other_reasons' => count(array_unique(array_map(fn (Report $r): string => $r->reason->value, $reports))) - ($top === null ? 0 : 1),
                'reporters' => $case->reporter_count,
                'reports' => $case->report_count,
                'automated' => CaseRecord::automatedDetection($case),
                'web_form' => in_array(ReportSource::WebForm, array_map(fn (Report $r): ReportSource => $r->source, $reports), true),
                'priority' => CasePriority::parts($case),
                'first_report_at' => $case->created_at?->toIso8601String(),
                'last_report_at' => is_string($lastReport) ? CarbonImmutable::parse($lastReport, 'UTC')->toIso8601String() : $case->created_at?->toIso8601String(),
                'assigned' => $case->assignedStaff instanceof Staff ? ['id' => $case->assignedStaff->id, 'name' => $case->assignedStaff->name, 'me' => $case->assignedStaff->id === $staff->id] : null,
                'ai_score' => $case->ai_score === null ? null : round((float) $case->ai_score, 2),
                'ai_summary' => $case->ai_summary,
                'decision' => $decision instanceof Decision ? ['action' => $decision->action->value, 'decided_at' => $decision->decided_at->toIso8601String()] : null,
            ];
        }, $cases);
    }

    /**
     * Tab counts (open tabs only for message cases when $messagesOnly).
     *
     * @return array<string, int>
     */
    public static function counts(bool $messagesOnly = false): array
    {
        $count = fn (array $statuses): int => ModerationCase::query()->whereIn('status', $statuses)
            ->when($messagesOnly, fn ($q) => $q->where('target_type', ReportTargetType::Message->value))->count();

        return [
            'new' => $count([CaseStatus::New->value]),
            'in_review' => $count([CaseStatus::InReview->value]),
            'decided' => $count([CaseStatus::Decided->value, CaseStatus::Closed->value]),
        ];
    }

    /**
     * The reference (last 8 of the id), the full id, or the target label.
     *
     * @param  Builder<Model>  $query
     */
    private static function text(Builder $query, string $value): void
    {
        $value = trim(mb_substr($value, 0, 120));

        if ($value === '') {
            return;
        }

        $reference = strtolower((string) preg_replace('/[^0-9A-Za-z]/', '', $value));

        $query->where(function (Builder $q) use ($value, $reference): void {
            if (strlen($reference) === 26) {
                $q->orWhere('moderation_cases.id', $reference);
            }
            if (strlen($reference) === 8) {
                $q->orWhere('moderation_cases.id', 'like', '%'.$reference);
            }
            $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value).'%';
            $q->orWhereRaw("moderation_cases.target_label like ? escape '!'", [$like])
                ->orWhereExists(fn ($sub) => $sub->selectRaw('1')->from('reports')->whereColumn('reports.case_id', 'moderation_cases.id')->whereRaw("reports.target_label like ? escape '!'", [$like]));
        });
    }
}
