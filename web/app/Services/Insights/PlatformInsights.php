<?php

namespace App\Services\Insights;

use App\Enums\RecapStatus;
use App\Enums\ViewSource;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * ADM-70 "Insights overview" (10 §11, m5.7-contract §9): the platform's totals of the M5.7 engagement features, for staff with
 * content.view. Sums per Europe/Berlin day and ISO week only — no per-member or per-vehicle drill-down, no names, no ids (10 §6.1): the
 * vehicle record ADM-10 already shows a car's sticker scans, and views per car stay with the owner (INS-01).
 *
 * Reads view_days (the live aggregates, `(day)` index), qr_scan_daily (raw sticker scans, as STK-04), weekly_recaps (`(week, status)`
 * index, kept 12 weeks) and engagement_daily (EngagementCounters: plan prompts sent, pushes the weekly cap dropped). A few grouped
 * queries, nothing per row.
 *
 * @phpstan-type Day array{date: string, views_by_source: array{app: int, web: int, sticker_scan: int, shared_link: int}, sticker_scans: int}
 * @phpstan-type Recap array{week: string, sent: int, skipped: int, unreachable: int}
 * @phpstan-type Overview array{days: list<Day>, recaps: list<Recap>, plan_prompts: array{last_7_days: int}, engagement_cap: array{pushes_dropped_last_7_days: int}}
 */
final class PlatformInsights
{
    /** The periods the page offers (days, today included). */
    public const PERIODS = [7, 30, 90];

    public const DEFAULT_DAYS = 30;

    /**
     * @return Overview
     */
    public function overview(int $days = self::DEFAULT_DAYS): array
    {
        $days = in_array($days, self::PERIODS, true) ? $days : self::DEFAULT_DAYS;
        $today = $this->today();
        $from = $today->subDays($days - 1);
        $range = [$from->toDateString(), $today->toDateString()];

        $views = [];
        foreach (DB::table('view_days')->whereBetween('day', $range)->groupBy('day', 'source')->selectRaw('day, source, SUM(views) as total')->get() as $row) {
            $views[substr((string) $row->day, 0, 10)][(string) $row->source] = (int) $row->total;
        }

        $scans = DB::table('qr_scan_daily')->whereBetween('day', $range)->groupBy('day')->selectRaw('day, SUM(`count`) as total')->pluck('total', 'day')
            ->mapWithKeys(fn (mixed $total, mixed $day): array => [substr((string) $day, 0, 10) => (int) $total])->all();

        $series = [];
        for ($day = $from; $day->lte($today); $day = $day->addDay()) {
            $date = $day->toDateString();
            $series[] = [
                'date' => $date,
                'views_by_source' => [
                    'app' => $views[$date][ViewSource::App->value] ?? 0,
                    'web' => $views[$date][ViewSource::Web->value] ?? 0,
                    'sticker_scan' => $views[$date][ViewSource::StickerScan->value] ?? 0,
                    'shared_link' => $views[$date][ViewSource::SharedLink->value] ?? 0,
                ],
                'sticker_scans' => $scans[$date] ?? 0,
            ];
        }

        return [
            'days' => $series,
            'recaps' => $this->recaps($from->startOfWeek(CarbonInterface::MONDAY)),
            'plan_prompts' => ['last_7_days' => EngagementCounters::lastDays(EngagementCounters::PLAN_PROMPT, 7)],
            'engagement_cap' => ['pushes_dropped_last_7_days' => EngagementCounters::lastDays(EngagementCounters::PUSH_DROPPED, 7)],
        ];
    }

    /**
     * The first Berlin day views were counted on (null before the first view), for "Gezählt seit …".
     */
    public function countingSince(): ?string
    {
        $first = DB::table('view_days')->min('day');

        return $first === null ? null : substr((string) $first, 0, 10);
    }

    /**
     * Newest week first; only the weeks that have recap rows.
     *
     * @return list<Recap>
     */
    private function recaps(CarbonImmutable $fromWeek): array
    {
        $weeks = [];
        $rows = DB::table('weekly_recaps')->where('week', '>=', $fromWeek->toDateString())
            ->groupBy('week', 'status')->selectRaw('week, status, COUNT(*) as total')->get();

        foreach ($rows as $row) {
            $week = substr((string) $row->week, 0, 10);
            $weeks[$week] ??= ['week' => $week, 'sent' => 0, 'skipped' => 0, 'unreachable' => 0];
            $status = RecapStatus::tryFrom((string) $row->status);

            if ($status !== null) {
                $weeks[$week][$status->value] += (int) $row->total;
            }
        }

        krsort($weeks);

        return array_values($weeks);
    }

    private function today(): CarbonImmutable
    {
        return CarbonImmutable::now(config()->string('speedclub.insights.timezone'))->startOfDay();
    }
}
