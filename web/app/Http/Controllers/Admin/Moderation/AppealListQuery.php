<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Enums\AppealStatus;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-20 "Einsprüche": the internal complaints (Art. 20 DSA), open first by default, with the decision they are about and who took it,
 * so the queue shows at a glance which ones this staff member may decide (another person than the decider). No complaint text here.
 */
final class AppealListQuery
{
    public const TABLE = 'moderation-appeals';

    public const DEFAULT_SORT = 'created_at';

    /**
     * @return QueryBuilder<Appeal>
     */
    public static function build(Request $request): QueryBuilder
    {
        $base = Appeal::query()->with(['appellant:id,username,deleted_at', 'decision.case', 'decision.decider:id,name']);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('status', function (Builder $q, mixed $value): void {
                    $status = AppealStatus::tryFrom(is_string($value) ? $value : '');
                    $q->where('appeals.status', $status->value ?? '-');
                })->delimiter("\u{1}"),
                AllowedFilter::callback('role', fn (Builder $q, mixed $value) => $q->where('appeals.role', in_array($value, ['affected', 'reporter'], true) ? $value : '-'))->delimiter("\u{1}"),
            )
            ->allowedSorts('created_at', 'decided_at')
            ->defaultSort(self::DEFAULT_SORT);

        // Open first unless a status was asked for, oldest first among them (they wait longest); the id breaks ties.
        if (! is_array($request->query('filter')) || ! isset($request->query('filter')['status'])) {
            $query->getEloquentBuilder()->getQuery()->orders = null;
            $query->getEloquentBuilder()->orderByRaw("case when appeals.status = 'open' then 0 else 1 end")->orderBy('appeals.created_at');
        }

        $query->getEloquentBuilder()->orderBy('appeals.id');

        return $query;
    }

    /**
     * @param  list<Appeal>  $appeals
     * @return list<array<string, mixed>>
     */
    public static function rows(array $appeals, Staff $staff): array
    {
        $caseIds = array_values(array_filter(array_map(fn (Appeal $appeal): ?string => $appeal->decision?->case_id, $appeals)));
        $labels = Report::query()->whereIn('case_id', $caseIds === [] ? ['-'] : $caseIds)->orderBy('created_at')->get(['case_id', 'target_label'])
            ->groupBy('case_id')->map(fn ($rows) => $rows->first()?->target_label);
        $deciders = Staff::query()->whereIn('id', array_values(array_filter(array_map(fn (Appeal $a): ?int => $a->decided_by, $appeals))))->pluck('name', 'id');

        return array_map(function (Appeal $appeal) use ($labels, $deciders, $staff): array {
            $decision = $appeal->decision;
            $case = $decision?->case;

            return [
                'id' => $appeal->id,
                'status' => $appeal->status->value,
                'role' => $appeal->role->value,
                'appellant' => $appeal->appellant instanceof User ? $appeal->appellant->username : null,
                'created_at' => $appeal->created_at->toIso8601String(),
                'decided_at' => $appeal->decided_at?->toIso8601String(),
                'decided_by' => $appeal->decided_by === null ? null : ($deciders[$appeal->decided_by] ?? null),
                'decision' => $decision instanceof Decision ? [
                    'id' => $decision->id,
                    'action' => $decision->action->value,
                    'decided_at' => $decision->decided_at->toIso8601String(),
                    'decided_by' => $decision->decider?->name,
                ] : null,
                'case' => $case instanceof ModerationCase ? [
                    'id' => $case->id,
                    'reference' => strtoupper(substr($case->id, -8)),
                    'target_type' => $case->target_type->value,
                    'target_label' => $case->target_label ?? ($labels[$case->id] ?? null),
                ] : null,
                // Another person than the decider (Art. 20(6) DSA).
                'may_decide' => $appeal->status === AppealStatus::Open && $staff->can('moderation.appeals') && $decision?->decided_by !== $staff->id,
            ];
        }, $appeals);
    }
}
