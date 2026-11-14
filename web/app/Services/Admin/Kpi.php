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

    public const CACHE_KEY = 'admin.kpi.tiles.v2';

    /** A queue item waiting longer than this is overdue (09 §10.2 SLA timers; the same day the Events/Business queues use). */
    public const SLA_MINUTES = 24 * 60;

    private const CACHE_SECONDS = 300;

    /** A frozen moment (QaClock, `?qaNow=` outside production) the day windows end on; null = the real clock. */
    private ?CarbonImmutable $frozen = null;

    /**
     * The same figures with the day windows ending on $moment's German day (DQ-1196: the visual matrix freezes the dashboard with the
     * `?qaNow=` the pages read). Null keeps the real clock. Writes, limits and the work queues always use the real clock.
     */
    public function at(?CarbonImmutable $moment): self
    {
        $copy = clone $this;
        $copy->frozen = $moment;

        return $copy;
    }

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
     * The six KPI tiles of 09 §10.2, cached for five minutes (the dashboard is opened often, the numbers move slowly). Real counts only:
     * a tile without data says so (value null) instead of showing a zero that reads like a measurement.
     *
     * @return list<array{key: string, unit: 'count'|'minutes'|'percent', value: int|float|null, previous: int|float|null, series: list<int|float|null>}>
     */
    public function tiles(): array
    {
        $key = $this->frozen === null ? self::CACHE_KEY : self::CACHE_KEY.':'.$this->today()->toDateString();

        /** @var list<array{key: string, unit: 'count'|'minutes'|'percent', value: int|float|null, previous: int|float|null, series: list<int|float|null>}> */
        return Cache::remember($key, self::CACHE_SECONDS, fn (): array => $this->kpis());
    }

    /**
     * The six tiles, uncached: neue Mitglieder (7 days), aktive Builds (30 days), QR-Scans (7 days), offene Meldungen (now),
     * Median-Bearbeitungszeit (7 days, minutes from the first report to the decision) and Push-Opt-in (share of the members active in
     * 30 days who receive pushes in the app or the browser). Each has the previous period of the same length (null where there is no
     * history) and 14 German days for the sparkline, oldest first (null for a day without a value). Sample rows (09 §8.19) never count.
     *
     * @return list<array{key: string, unit: 'count'|'minutes'|'percent', value: int|float|null, previous: int|float|null, series: list<int|float|null>}>
     */
    public function kpis(): array
    {
        $today = $this->today();
        // The $days German days that end $endAgo days before today.
        $sum = fn (array $perDay, int $endAgo, int $days): int => array_sum($this->series($perDay, $today->subDays($endAgo), $days));

        $members = $this->perDay(DB::table('users')->whereNull('deleted_at')->where('is_sample', false), 'created_at', $today->subDays(13), 14);
        $scans = $this->scansPerDay($today->subDays(13), 14);
        ['value' => $median, 'previous' => $medianBefore, 'series' => $medianSeries] = $this->medianDecisionMinutes($today);
        ['value' => $optIn, 'previous' => $optInBefore, 'series' => $optInSeries] = $this->pushOptInTile($today);

        return [
            ['key' => 'members_7d', 'unit' => 'count', 'value' => $sum($members, 0, 7), 'previous' => $sum($members, 7, 7), 'series' => $this->series($members, $today, self::SERIES_DAYS)],
            ['key' => 'active_builds', 'unit' => 'count', ...$this->activeBuilds($today)],
            ['key' => 'qr_scans_7d', 'unit' => 'count', 'value' => $sum($scans, 0, 7), 'previous' => $sum($scans, 7, 7), 'series' => $this->series($scans, $today, self::SERIES_DAYS)],
            ['key' => 'open_reports', 'unit' => 'count', ...$this->openReports($today)],
            ['key' => 'median_decision', 'unit' => 'minutes', 'value' => $median, 'previous' => $medianBefore, 'series' => $medianSeries],
            ['key' => 'push_opt_in', 'unit' => 'percent', 'value' => $optIn, 'previous' => $optInBefore, 'series' => $optInSeries],
        ];
    }

    /**
     * Push-Opt-in now: members active in the last 30 days (present, not samples) and how many of them have an app push token or a
     * browser subscription. Stored once a day by speedclub:kpi-snapshot for the tile's history.
     *
     * @return array{members: int, base: int}
     */
    public function pushOptIn(): array
    {
        $active = fn () => DB::table('users')->whereNull('deleted_at')->where('is_sample', false)
            ->where('last_seen_at', '>=', $this->utc($this->today()->subDays(29)));
        $base = $active()->count();
        $members = $base === 0 ? 0 : $active()
            ->where(fn (Builder $query) => $query
                ->whereExists(fn (Builder $tokens) => $tokens->selectRaw('1')->from('push_tokens')->whereColumn('push_tokens.user_id', 'users.id'))
                ->orWhereExists(fn (Builder $browsers) => $browsers->selectRaw('1')->from('push_subscriptions')->whereColumn('push_subscriptions.user_id', 'users.id')))
            ->count();

        return ['members' => $members, 'base' => $base];
    }

    /**
     * Stores today's Push-Opt-in on the day before (the snapshot runs just after midnight, like the WAU).
     *
     * @return array{members: int, base: int}
     */
    public function snapshotPushOptIn(): array
    {
        $figure = $this->pushOptIn();
        $day = $this->today()->subDay()->toDateString();
        DB::table('activity_days')->upsert([['day' => $day, 'members' => 0, 'push_members' => $figure['members'], 'push_base' => $figure['base']]], ['day'], ['push_members', 'push_base']);
        Cache::forget(self::CACHE_KEY);

        return $figure;
    }

    /**
     * Published builds (not deleted, not samples) with a visible build update in the last 30 German days; the previous 30 days before;
     * the series counts the builds with an update per day.
     *
     * @return array{value: int, previous: int, series: list<int>}
     */
    private function activeBuilds(CarbonImmutable $today): array
    {
        $updates = fn (CarbonImmutable $from, CarbonImmutable $to) => DB::table('build_updates')
            ->join('vehicles', 'vehicles.id', '=', 'build_updates.vehicle_id')
            ->where('build_updates.hidden', false)
            ->where('vehicles.status', VehicleStatus::Published->value)
            ->whereNull('vehicles.deleted_at')
            ->where('vehicles.is_sample', false)
            ->where('build_updates.created_at', '>=', $this->utc($from))
            ->where('build_updates.created_at', '<', $this->utc($to));
        $distinct = fn (CarbonImmutable $from, CarbonImmutable $to): int => (int) $updates($from, $to)->distinct()->count('build_updates.vehicle_id');

        $rows = $updates($today->subDays(self::SERIES_DAYS - 1), $today->addDay())
            ->selectRaw("DATE_FORMAT(build_updates.created_at, '%Y-%m-%d %H') AS bucket, build_updates.vehicle_id AS vehicle")
            ->get();
        $perDay = [];

        foreach ($rows as $row) {
            $day = CarbonImmutable::createFromFormat('Y-m-d H', (string) $row->bucket, 'UTC');

            if ($day !== null) {
                $perDay[$day->setTimezone(config()->string('speedclub.display_timezone'))->toDateString()][(string) $row->vehicle] = true;
            }
        }

        return [
            'value' => $distinct($today->subDays(29), $today->addDay()),
            'previous' => $distinct($today->subDays(59), $today->subDays(29)),
            'series' => array_map(fn (string $day): int => count($perDay[$day] ?? []), $this->days($today, self::SERIES_DAYS)),
        ];
    }

    /**
     * Open cases now; at the end of each of the last 14 German days (opened before, decided after or not yet) for the series; a week
     * ago for the previous value.
     *
     * @return array{value: int, previous: int, series: list<int>}
     */
    private function openReports(CarbonImmutable $today): array
    {
        $now = (int) DB::table('moderation_cases')->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value])->count();
        $from = $today->subDays(self::SERIES_DAYS);
        $cases = DB::table('moderation_cases')
            ->where('created_at', '<', $this->utc($today->addDay()))
            ->where(fn (Builder $query) => $query->whereNull('decided_at')->orWhere('decided_at', '>=', $this->utc($from)))
            ->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value, CaseStatus::Decided->value])
            ->get(['created_at', 'decided_at']);
        $openAt = fn (CarbonImmutable $end): int => $cases->filter(function (object $case) use ($end): bool {
            $opened = CarbonImmutable::parse((string) $case->created_at, 'UTC');
            $decided = $case->decided_at === null ? null : CarbonImmutable::parse((string) $case->decided_at, 'UTC');

            return $opened->lessThan($end) && ($decided === null || $decided->greaterThanOrEqualTo($end));
        })->count();

        $series = array_map(fn (string $day): int => $openAt(CarbonImmutable::parse($day, config()->string('speedclub.display_timezone'))->addDay()), $this->days($today->subDay(), self::SERIES_DAYS - 1));

        return ['value' => $now, 'previous' => $openAt($today->subDays(6)), 'series' => [...$series, $now]];
    }

    /**
     * The median minutes from a case's first report to its decision, over the cases decided by staff in the last 7 German days (null
     * without one), the 7 days before, and per day for the series (null on a day without a decision).
     *
     * @return array{value: int|null, previous: int|null, series: list<int|null>}
     */
    private function medianDecisionMinutes(CarbonImmutable $today): array
    {
        $zone = config()->string('speedclub.display_timezone');
        $rows = DB::table('decisions')
            ->join('moderation_cases', 'moderation_cases.id', '=', 'decisions.case_id')
            ->whereNotNull('decisions.decided_by')
            ->where('decisions.decided_at', '>=', $this->utc($today->subDays(self::SERIES_DAYS - 1)))
            ->get(['decisions.decided_at', 'moderation_cases.created_at']);
        $byDay = [];

        foreach ($rows as $row) {
            $decided = CarbonImmutable::parse((string) $row->decided_at, 'UTC');
            $minutes = max(0, intdiv($decided->getTimestamp() - CarbonImmutable::parse((string) $row->created_at, 'UTC')->getTimestamp(), 60));
            $byDay[$decided->setTimezone($zone)->toDateString()][] = $minutes;
        }

        $days = $this->days($today, self::SERIES_DAYS);
        $window = fn (array $list): array => array_merge(...array_map(fn (string $day): array => $byDay[$day] ?? [], $list));

        return [
            'value' => self::median($window(array_slice($days, 7))),
            'previous' => self::median($window(array_slice($days, 0, 7))),
            'series' => array_map(fn (string $day): ?int => self::median($byDay[$day] ?? []), $days),
        ];
    }

    /**
     * Now from pushOptIn(); history from the daily snapshots (a day before the first snapshot is null, never a guess).
     *
     * @return array{value: float|null, previous: float|null, series: list<float|null>}
     */
    private function pushOptInTile(CarbonImmutable $today): array
    {
        $share = fn (int $members, int $base): ?float => $base === 0 ? null : round($members / $base, 3);
        $now = $this->pushOptIn();
        $stored = DB::table('activity_days')->where('day', '>=', $today->subDays(self::SERIES_DAYS)->toDateString())->whereNotNull('push_base')
            ->get(['day', 'push_members', 'push_base'])->keyBy(fn (object $row): string => substr((string) $row->day, 0, 10));
        $at = fn (string $day): ?float => isset($stored[$day]) ? $share((int) $stored[$day]->push_members, (int) $stored[$day]->push_base) : null;
        $value = $share($now['members'], $now['base']);

        return [
            'value' => $value,
            'previous' => $at($today->subDays(7)->toDateString()),
            'series' => [...array_map($at, $this->days($today->subDay(), self::SERIES_DAYS - 1)), $value],
        ];
    }

    /**
     * @param  list<int>  $values
     */
    private static function median(array $values): ?int
    {
        if ($values === []) {
            return null;
        }

        sort($values);
        $middle = intdiv(count($values), 2);

        return count($values) % 2 === 1 ? $values[$middle] : intdiv($values[$middle - 1] + $values[$middle], 2);
    }

    /**
     * The three charts: registrations per day (the 30 full days before today), QR scans against sign-ups that began on a QR scan (30 days), and the ten makes
     * with the most published vehicles.
     *
     * @return array{registrations: list<array{date: string, value: int}>, qr_funnel: list<array{date: string, scans: int, registrations: int}>, top_makes: list<array{label: string, value: int}>}
     */
    public function charts(): array
    {
        // DQ-1196: the last 30 full days. Today is still running, and its partial count read as a drop to zero at the line's end.
        $lastDay = $this->today()->subDay();
        $from = $lastDay->subDays(self::CHART_DAYS - 1);
        $members = $this->perDay(DB::table('users')->whereNull('deleted_at'), 'created_at', $from, self::CHART_DAYS);
        $scans = $this->scansPerDay($from, self::CHART_DAYS);
        $qrSignups = $this->perDay(DB::table('users')->where('signup_ref', SignupRef::Qr->value), 'created_at', $from, self::CHART_DAYS);
        $days = $this->days($lastDay, self::CHART_DAYS);

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

        return self::waitingSince($count, is_string($oldest) ? CarbonImmutable::parse($oldest, 'UTC') : null);
    }

    /**
     * A work queue's count with its oldest item as `since`. DQ-1194: `warning` only once that item is overdue (SLA_MINUTES), so the
     * dashboard colours late queues, not every queue that has work.
     *
     * @return array{count: int, status: 'ok'|'warning', since: string|null}
     */
    public static function waitingSince(int $count, ?CarbonImmutable $oldest): array
    {
        $overdue = $count > 0 && $oldest !== null && $oldest->diffInMinutes(now(), true) >= self::SLA_MINUTES;

        return [
            'count' => $count,
            'status' => $overdue ? 'warning' : 'ok',
            'since' => $oldest?->toIso8601String(),
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
        $zone = config()->string('speedclub.display_timezone');

        return ($this->frozen?->setTimezone($zone) ?? CarbonImmutable::now($zone))->startOfDay();
    }

    private function utc(CarbonImmutable $germanDay): string
    {
        return $germanDay->startOfDay()->utc()->format('Y-m-d H:i:s');
    }
}
