<?php

namespace App\Services\Insights;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * views:prune (m5.7-contract §7, daily 04:15 Europe/Berlin): raw view events after `insights.raw_retention_days` (90) in batches of
 * `insights.prune_batch` until done or `insights.seconds` (40) are used — the daily totals in view_days stay; the salts of every day before
 * today; weekly recaps after 12 weeks; engagement push claims after 14 days; the ADM-70 day counters (engagement_daily) after 400 days.
 * Deletes only, so a second run changes nothing. pruneSalts() alone runs just after midnight too, so a day's salt is gone with the day.
 *
 * @phpstan-type Pruned array{view_events: int, view_salts: int, weekly_recaps: int, engagement_push_claims: int, engagement_daily: int, done: bool}
 */
final class ViewRetention
{
    public const RECAP_WEEKS = 12;

    public const CLAIM_DAYS = 14;

    public const COUNTER_DAYS = 400;

    public function __construct(private readonly ViewSalts $salts) {}

    /**
     * @return Pruned
     */
    public function prune(): array
    {
        $started = microtime(true);
        $zone = config()->string('speedclub.insights.timezone');
        $today = CarbonImmutable::now($zone)->startOfDay();
        // SF-2: events keep only their Berlin day, so they go by day.
        $cutoff = $today->subDays(config()->integer('speedclub.insights.raw_retention_days'))->toDateString();
        $batch = max(1, config()->integer('speedclub.insights.prune_batch'));
        $budget = config()->integer('speedclub.insights.seconds');
        $events = 0;
        $done = false;

        while (microtime(true) - $started < $budget) {
            $ids = DB::table('view_events')->where('day', '<', $cutoff)->orderBy('id')->limit($batch)->pluck('id')->all();

            if ($ids === []) {
                $done = true;
                break;
            }

            $events += DB::table('view_events')->whereIn('id', $ids)->delete();
        }

        return [
            'view_events' => $events,
            'view_salts' => $this->salts->pruneBefore($today->toDateString()),
            'weekly_recaps' => DB::table('weekly_recaps')->where('week', '<', $today->startOfWeek(CarbonInterface::MONDAY)->subWeeks(self::RECAP_WEEKS)->toDateString())->delete(),
            'engagement_push_claims' => DB::table('engagement_push_claims')->where('week', '<', $today->subDays(self::CLAIM_DAYS)->startOfWeek(CarbonInterface::MONDAY)->toDateString())->delete(),
            'engagement_daily' => DB::table('engagement_daily')->where('day', '<', $today->subDays(self::COUNTER_DAYS)->toDateString())->delete(),
            'done' => $done,
        ];
    }

    /**
     * The salts of every Berlin day before today (views:prune --salts, scheduled 00:05 Europe/Berlin).
     */
    public function pruneSalts(): int
    {
        return $this->salts->pruneBefore(CarbonImmutable::now(config()->string('speedclub.insights.timezone'))->toDateString());
    }
}
