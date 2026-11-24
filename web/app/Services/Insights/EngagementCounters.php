<?php

namespace App\Services\Insights;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Platform-wide daily counters for the admin Insights overview (ADM-70, m5.7-contract §9): how many engagement pushes the weekly cap
 * dropped and how many plan prompts went out, per Europe/Berlin day. Counts only: no member, vehicle or notification is stored, so the
 * numbers can never be traced back to a person (10 §6.1). Never throws: a counter that fails to write must not stop a push or a prompt.
 */
final class EngagementCounters
{
    public const PUSH_DROPPED = 'push_dropped';

    public const PLAN_PROMPT = 'plan_prompt';

    public static function bump(string $metric, int $by = 1): void
    {
        try {
            $day = CarbonImmutable::now(config()->string('speedclub.insights.timezone'))->toDateString();
            // The day's row once (two writers at the same moment both land on the unique key), then an atomic increment.
            DB::table('engagement_daily')->insertOrIgnore(['day' => $day, 'metric' => $metric, 'count' => 0]);
            DB::table('engagement_daily')->where('day', $day)->where('metric', $metric)->increment('count', max(0, $by));
        } catch (Throwable $error) {
            report($error);
        }
    }

    /**
     * The metric's total over the last $days Berlin days, today included.
     */
    public static function lastDays(string $metric, int $days): int
    {
        $today = CarbonImmutable::now(config()->string('speedclub.insights.timezone'))->startOfDay();

        return (int) DB::table('engagement_daily')->where('metric', $metric)
            ->whereBetween('day', [$today->subDays($days - 1)->toDateString(), $today->toDateString()])
            ->sum('count');
    }
}
