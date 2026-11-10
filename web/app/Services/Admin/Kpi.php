<?php

namespace App\Services\Admin;

use App\Enums\AppealStatus;
use App\Enums\CaseStatus;
use App\Enums\SignupRef;
use App\Enums\SupportTicketStatus;
use App\Enums\VehicleStatus;
use App\Models\Staff;
use App\Services\Privacy\PrivacyRequests;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Spatie\Health\Checks\Checks\ScheduleCheck;

/**
 * ADM-06 dashboard data (06_ADMIN_SPEC §3 Overview, ADR-216). Counts only, as plain arrays in the shapes the admin renders. Days are
 * German days (speedclub.display_timezone); per-day counts come from hourly buckets in SQL, mapped to German days here, because the
 * German offset is always a whole number of hours and shared hosts often lack MySQL's time zone tables. Every query reads an index;
 * KpiPerformanceTest (group perf) holds the whole dashboard to a time budget on 20,000 members and 2,000 vehicles.
 */
final class Kpi
{
    private const SERIES_DAYS = 14;

    private const CHART_DAYS = 30;

    /**
     * Work queues, only those the staff member's atoms cover. Keys: reports, appeals, support_tickets (oldest open item as `since`),
     * privacy_due (GDPR requests due within 7 days, earliest due date as `since`, danger when one is overdue),
     * failed_jobs, scheduler (last heartbeat), queue (jobs waiting; status by the oldest one's age).
     *
     * @return array<string, array{count: int|null, status: 'ok'|'warning'|'danger', since: string|null}>
     */
    public function queues(Staff $staff): array
    {
        $queues = [];

        if ($staff->can('moderation.view')) {
            $queues['reports'] = $this->openItems(DB::table('moderation_cases')->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value]));
        }

        if ($staff->can('moderation.appeals')) {
            $queues['appeals'] = $this->openItems(DB::table('appeals')->where('status', AppealStatus::Open->value));
        }

        if ($staff->can('support.view')) {
            $queues['support_tickets'] = $this->openItems(DB::table('support_tickets')->whereIn('status', [SupportTicketStatus::Open->value, SupportTicketStatus::Pending->value]));
        }

        // M3.6: open GDPR requests due within 7 days (overdue ones too), the earliest due date as `since`.
        if ($staff->can('privacy.view')) {
            $queues['privacy_due'] = app(PrivacyRequests::class)->dueQueue();
        }

        if ($staff->can('system.view')) {
            $failed = DB::table('failed_jobs')->count();
            $queues['failed_jobs'] = ['count' => $failed, 'status' => $failed > 0 ? 'danger' : 'ok', 'since' => null];
            $queues['scheduler'] = $this->scheduler();
            $queues['queue'] = $this->queueBacklog();
        }

        return $queues;
    }

    /**
     * Members active today, in the last 7 and in the last 30 German days, from one source: present (not deleted) members by their
     * last_seen_at. Each window contains the shorter one, so dau ≤ wau ≤ mau always (DQ-571).
     *
     * @return array{dau: int, wau: int, mau: int}
     */
    public function activeMembers(): array
    {
        $today = $this->today();
        $since = fn (int $days): int => DB::table('users')->whereNull('deleted_at')->where('last_seen_at', '>=', $this->utc($today->subDays($days)))->count();

        return ['dau' => $since(0), 'wau' => $since(6), 'mau' => $since(29)];
    }

    /**
     * KPI tiles: the value, the previous period for the delta (null where there is none), and 14 daily values for the sparkline,
     * oldest first. Keys: members_today, members_7d, members_30d, dau, wau, vehicles_published, qr_scans_7d, qr_registrations_7d,
     * messages_7d.
     *
     * @return list<array{key: string, value: int, previous: int|null, series: list<int>}>
     */
    public function kpis(): array
    {
        $today = $this->today();
        $members = $this->perDay(DB::table('users')->whereNull('deleted_at'), 'created_at', $today->subDays(59), 60);
        $memberSeries = $this->series($members, $today, self::SERIES_DAYS);
        // The $days German days that end $endAgo days before today.
        $sum = fn (array $perDay, int $endAgo, int $days): int => array_sum($this->series($perDay, $today->subDays($endAgo), $days));

        $activity = DB::table('activity_days')
            ->where('day', '>=', $today->subDays(self::SERIES_DAYS)->toDateString())
            ->get(['day', 'members', 'weekly'])
            ->keyBy(fn (object $row): string => substr((string) $row->day, 0, 10));
        $dau = array_map(fn (string $day): int => (int) ($activity[$day]->members ?? 0), $this->days($today, self::SERIES_DAYS));
        $weekly = array_map(fn (string $day): int => (int) ($activity[$day]->weekly ?? 0), $this->days($today->subDay(), self::SERIES_DAYS - 1));
        // DQ-571: today's DAU and the WAU from one source, so the week can never show fewer members than the day; the counters stay
        // the sparkline history (they also counted accounts deleted since).
        ['dau' => $dauToday, 'wau' => $wau] = $this->activeMembers();
        $dau = [...array_slice($dau, 0, -1), $dauToday];
        $weekAgo = $activity[$today->subDays(7)->toDateString()]->weekly ?? null;

        $published = $this->perDay(DB::table('vehicles')->where('status', VehicleStatus::Published->value)->whereNull('deleted_at'), 'published_at', $today->subDays(self::SERIES_DAYS - 1), self::SERIES_DAYS);
        $scans = $this->scansPerDay($today->subDays(13), 14);
        $qrSignups = $this->perDay(DB::table('users')->where('signup_ref', SignupRef::Qr->value), 'created_at', $today->subDays(13), 14);
        $messages = $this->perDay(DB::table('messages'), 'created_at', $today->subDays(13), 14);

        return [
            ['key' => 'members_today', 'value' => $members[$today->toDateString()] ?? 0, 'previous' => $members[$today->subDay()->toDateString()] ?? 0, 'series' => $memberSeries],
            ['key' => 'members_7d', 'value' => $sum($members, 0, 7), 'previous' => $sum($members, 7, 7), 'series' => $memberSeries],
            ['key' => 'members_30d', 'value' => $sum($members, 0, 30), 'previous' => $sum($members, 30, 30), 'series' => $memberSeries],
            ['key' => 'dau', 'value' => $dau[self::SERIES_DAYS - 1], 'previous' => $dau[self::SERIES_DAYS - 2], 'series' => $dau],
            ['key' => 'wau', 'value' => $wau, 'previous' => $weekAgo === null ? null : (int) $weekAgo, 'series' => [...$weekly, $wau]],
            [
                'key' => 'vehicles_published',
                'value' => DB::table('vehicles')->where('status', VehicleStatus::Published->value)->whereNull('deleted_at')->count(),
                'previous' => null,
                'series' => $this->series($published, $today, self::SERIES_DAYS),
            ],
            ...array_map(fn (string $key, array $perDay): array => [
                'key' => $key,
                'value' => $sum($perDay, 0, 7),
                'previous' => $sum($perDay, 7, 7),
                'series' => $this->series($perDay, $today, self::SERIES_DAYS),
            ], ['qr_scans_7d', 'qr_registrations_7d', 'messages_7d'], [$scans, $qrSignups, $messages]),
        ];
    }

    /**
     * The three charts: registrations per day (30 days), QR scans against sign-ups that began on a QR scan (30 days), and the ten makes
     * with the most published vehicles.
     *
     * @return array{registrations: list<array{date: string, value: int}>, qr_funnel: list<array{date: string, scans: int, registrations: int}>, top_makes: list<array{label: string, value: int}>}
     */
    public function charts(): array
    {
        $today = $this->today();
        $from = $today->subDays(self::CHART_DAYS - 1);
        $members = $this->perDay(DB::table('users')->whereNull('deleted_at'), 'created_at', $from, self::CHART_DAYS);
        $scans = $this->scansPerDay($from, self::CHART_DAYS);
        $qrSignups = $this->perDay(DB::table('users')->where('signup_ref', SignupRef::Qr->value), 'created_at', $from, self::CHART_DAYS);
        $days = $this->days($today, self::CHART_DAYS);

        $makes = DB::table('vehicles')
            ->leftJoin('makes', 'makes.id', '=', 'vehicles.make_id')
            ->where('vehicles.status', VehicleStatus::Published->value)
            ->whereNull('vehicles.deleted_at')
            ->selectRaw('COALESCE(makes.name, vehicles.make_text) AS label, COUNT(*) AS value')
            ->groupByRaw('COALESCE(makes.name, vehicles.make_text)')
            ->orderByDesc('value')
            ->orderBy('label')
            ->limit(10)
            ->get();

        return [
            'registrations' => array_map(fn (string $day): array => ['date' => $day, 'value' => $members[$day] ?? 0], $days),
            'qr_funnel' => array_map(fn (string $day): array => ['date' => $day, 'scans' => $scans[$day] ?? 0, 'registrations' => $qrSignups[$day] ?? 0], $days),
            'top_makes' => array_values($makes
                ->filter(fn (object $row): bool => is_string($row->label) && $row->label !== '')
                ->map(fn (object $row): array => ['label' => (string) $row->label, 'value' => (int) $row->value])
                ->all()),
        ];
    }

    /**
     * DSA Art. 24(3): the average of monthly active members over the last six full German months. Months before the counters
     * existed are left out of the average; null when there is none.
     *
     * @return array{average: int|null, months: list<array{month: string, value: int}>}
     */
    public function dsa(): array
    {
        $current = $this->today()->startOfMonth();
        $months = array_map(fn (int $ago): string => $current->subMonthsNoOverflow($ago)->toDateString(), range(6, 1));
        $rows = [];

        foreach (DB::table('activity_months')->whereIn('month', $months)->get(['month', 'members']) as $row) {
            $rows[substr((string) $row->month, 0, 10)] = (int) $row->members;
        }

        $known = array_values(array_filter($months, fn (string $month): bool => isset($rows[$month])));

        return [
            'average' => $known === [] ? null : (int) round(array_sum(array_map(fn (string $month): int => $rows[$month], $known)) / count($known)),
            'months' => array_map(fn (string $month): array => ['month' => substr($month, 0, 7), 'value' => $rows[$month] ?? 0], $months),
        ];
    }

    /**
     * @return array{count: int, status: 'ok'|'warning', since: string|null}
     */
    private function openItems(Builder $query): array
    {
        $row = $query->selectRaw('COUNT(*) AS open_count, MIN(created_at) AS oldest')->first();
        $count = (int) ($row->open_count ?? 0);
        $oldest = $row->oldest ?? null;

        return [
            'count' => $count,
            'status' => $count > 0 ? 'warning' : 'ok',
            'since' => is_string($oldest) ? CarbonImmutable::parse($oldest, 'UTC')->toIso8601String() : null,
        ];
    }

    /**
     * @return array{count: null, status: 'ok'|'danger', since: string|null}
     */
    private function scheduler(): array
    {
        $check = ScheduleCheck::new();
        $last = Cache::store($check->getCacheStoreName())->get($check->getCacheKey());

        if (! is_numeric($last)) {
            return ['count' => null, 'status' => 'danger', 'since' => null];
        }

        $minutes = (now()->getTimestamp() - (int) $last) / 60;

        return [
            'count' => null,
            'status' => $minutes <= config()->integer('speedclub.doctor.cron_max_age_minutes') ? 'ok' : 'danger',
            'since' => CarbonImmutable::createFromTimestamp((int) $last)->toIso8601String(),
        ];
    }

    /**
     * @return array{count: int, status: 'ok'|'warning', since: string|null}
     */
    private function queueBacklog(): array
    {
        $row = DB::table('jobs')->whereNull('reserved_at')->where('available_at', '<=', now()->getTimestamp())
            ->selectRaw('COUNT(*) AS waiting, MIN(available_at) AS oldest')->first();
        $waiting = (int) ($row->waiting ?? 0);
        $oldest = $row?->oldest;
        $oldest = is_numeric($oldest) ? (int) $oldest : null;
        $late = $oldest !== null && now()->getTimestamp() - $oldest > config()->integer('speedclub.doctor.queue_max_backlog_minutes') * 60;

        return [
            'count' => $waiting,
            'status' => $late ? 'warning' : 'ok',
            'since' => $oldest === null ? null : CarbonImmutable::createFromTimestamp($oldest)->toIso8601String(),
        ];
    }

    /**
     * Rows per German day of $from and the $days after it, from hourly buckets.
     *
     * @param  'created_at'|'published_at'  $column
     * @return array<string, int>
     */
    private function perDay(Builder $query, string $column, CarbonImmutable $from, int $days): array
    {
        $bucket = $column === 'created_at'
            ? "DATE_FORMAT(created_at, '%Y-%m-%d %H') AS bucket, COUNT(*) AS n"
            : "DATE_FORMAT(published_at, '%Y-%m-%d %H') AS bucket, COUNT(*) AS n";

        $rows = $query
            ->where($column, '>=', $this->utc($from))
            ->where($column, '<', $this->utc($from->addDays($days)))
            ->selectRaw($bucket)
            ->groupBy('bucket')
            ->get();

        $perDay = [];

        foreach ($rows as $row) {
            $day = CarbonImmutable::createFromFormat('Y-m-d H', (string) $row->bucket, 'UTC');

            if ($day !== null) {
                $key = $day->setTimezone(config()->string('speedclub.display_timezone'))->toDateString();
                $perDay[$key] = ($perDay[$key] ?? 0) + (int) $row->n;
            }
        }

        return $perDay;
    }

    /**
     * QR scans are stored per German day already (QrScans).
     *
     * @return array<string, int>
     */
    private function scansPerDay(CarbonImmutable $from, int $days): array
    {
        return DB::table('qr_scan_daily')
            ->where('day', '>=', $from->toDateString())
            ->where('day', '<', $from->addDays($days)->toDateString())
            ->groupBy('day')
            ->selectRaw('day, SUM(count) AS n')
            ->get()
            ->mapWithKeys(fn (object $row): array => [substr((string) $row->day, 0, 10) => (int) $row->n])
            ->all();
    }

    /**
     * @param  array<string, int>  $perDay
     * @return list<int>
     */
    private function series(array $perDay, CarbonImmutable $lastDay, int $days): array
    {
        return array_map(fn (string $day): int => $perDay[$day] ?? 0, $this->days($lastDay, $days));
    }

    /**
     * $days German dates ending with $lastDay, oldest first.
     *
     * @return list<string>
     */
    private function days(CarbonImmutable $lastDay, int $days): array
    {
        return array_map(fn (int $ago): string => $lastDay->subDays($ago)->toDateString(), range($days - 1, 0));
    }

    private function today(): CarbonImmutable
    {
        return CarbonImmutable::now(config()->string('speedclub.display_timezone'))->startOfDay();
    }

    private function utc(CarbonImmutable $germanDay): string
    {
        return $germanDay->startOfDay()->utc()->format('Y-m-d H:i:s');
    }
}
