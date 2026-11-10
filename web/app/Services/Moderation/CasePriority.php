<?php

namespace App\Services\Moderation;

use App\Models\ModerationCase;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * The ADM-20 priority (m3.4-contract §1), never a black box: the stored base (highest reason weight of the reports, plus 2 per further
 * distinct reporter up to 20, SubmitReport), plus 5 per earlier restrictive decision about the same member in the last 12 months (repeat
 * target, up to 15), plus 1 per day the case has been waiting (up to 10). The queue sorts by the sum; the tooltip shows each part.
 */
final class CasePriority
{
    public const REPEAT_POINTS = 5;

    public const REPEAT_MAX = 15;

    public const REPEAT_MONTHS = 12;

    public const AGE_MAX = 10;

    public const REPORTER_POINTS = 2;

    public const REPORTER_MAX = 20;

    /** Earlier restrictive decisions about the case's member, decided before this case's own decision (bindings: since, now). */
    private const REPEAT_SQL = 'select count(*) from decisions as prior_decisions where moderation_cases.subject_id is not null'
        .' and prior_decisions.subject_id = moderation_cases.subject_id'
        ." and prior_decisions.action in ('remove_content', 'restrict', 'suspend')"
        .' and prior_decisions.case_id <> moderation_cases.id'
        .' and prior_decisions.decided_at >= ?'
        .' and prior_decisions.decided_at <= COALESCE(moderation_cases.decided_at, ?)';

    /** Whole days the case has been waiting (binding: now). */
    private const AGE_SQL = 'TIMESTAMPDIFF(DAY, moderation_cases.created_at, COALESCE(moderation_cases.decided_at, ?))';

    /**
     * Adds `priority_repeat`, `priority_age` and `priority_score` to the select of a case query.
     *
     * @param  Builder<ModerationCase>  $query
     * @return Builder<ModerationCase>
     */
    public static function select(Builder $query, CarbonImmutable $now): Builder
    {
        $at = $now->utc()->format('Y-m-d H:i:s');
        $since = $now->subMonths(self::REPEAT_MONTHS)->utc()->format('Y-m-d H:i:s');

        return $query
            ->addSelect('moderation_cases.*')
            ->selectRaw('('.self::REPEAT_SQL.') as priority_repeat', [$since, $at])
            ->selectRaw('LEAST(?, GREATEST(0, '.self::AGE_SQL.')) as priority_age', [self::AGE_MAX, $at])
            ->selectRaw('moderation_cases.priority + LEAST(?, ? * ('.self::REPEAT_SQL.')) + LEAST(?, GREATEST(0, '.self::AGE_SQL.')) as priority_score', [
                self::REPEAT_MAX, self::REPEAT_POINTS, $since, $at, self::AGE_MAX, $at,
            ]);
    }

    /**
     * The parts of one case's priority, as the tooltip lists them.
     *
     * @return array{total: int, reason: int, reporters: int, reporter_count: int, repeat: int, repeat_count: int, age: int, age_days: int}
     */
    public static function parts(ModerationCase $case): array
    {
        $repeatCount = (int) ($case->getAttribute('priority_repeat') ?? 0);
        $ageDays = (int) ($case->getAttribute('priority_age') ?? 0);
        $reporterBonus = max(0, $case->priority - $case->reason_weight);
        $repeat = min(self::REPEAT_MAX, self::REPEAT_POINTS * $repeatCount);
        $age = min(self::AGE_MAX, max(0, $ageDays));

        return [
            'total' => $case->priority + $repeat + $age,
            'reason' => $case->reason_weight,
            'reporters' => $reporterBonus,
            'reporter_count' => $case->reporter_count,
            'repeat' => $repeat,
            'repeat_count' => $repeatCount,
            'age' => $age,
            'age_days' => $ageDays,
        ];
    }
}
