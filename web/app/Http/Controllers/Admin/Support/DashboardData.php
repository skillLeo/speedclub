<?php

namespace App\Http\Controllers\Admin\Support;

use App\Enums\BusinessStatus;
use App\Enums\EventStatus;
use App\Models\Business;
use App\Models\Event;
use App\Models\Staff;
use App\Services\Admin\Kpi;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * Dashboard data for ADM-06 in the shape the page renders (resources/js/admin/types/dashboard.ts), from App\Services\Admin\Kpi
 * (contract §1.6). Each method may throw: the controller sends KPIs, charts and DSA as rescued deferred props, so one failing
 * section shows its own error (partial failure).
 */
class DashboardData
{
    public function __construct(private readonly Kpi $kpi) {}

    /**
     * Work queues by key, only those the staff member's atoms cover. A key without a registered tile
     * (resources/js/admin/modules/*.ts) is ignored by the page.
     *
     * @return array<string, array{count: int|null, status: 'ok'|'warning'|'danger', since: string|null}>
     */
    public function queues(Staff $staff): array
    {
        $queues = $this->kpi->queues($staff);

        // M4.17: the review queues of 09 §10.2 (ADM-53 Treffen, ADM-55 Betriebe), oldest submission as `since` (the SLA).
        if ($staff->can('moderation.view')) {
            $queues['events_review'] = self::waiting(Event::query()->where('status', EventStatus::PendingReview->value));
            $queues['business_applications'] = self::waiting(Business::query()->where('status', BusinessStatus::Applied->value));
        }

        return $queues;
    }

    /**
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $query
     * @return array{count: int, status: 'ok'|'warning', since: string|null}
     */
    private static function waiting(Builder $query): array
    {
        $count = (clone $query)->count();
        $oldest = $count > 0 ? (clone $query)->min('submitted_at') : null;

        return Kpi::waitingSince($count, is_string($oldest) ? CarbonImmutable::parse($oldest, 'UTC') : null);
    }

    /**
     * The six KPI tiles of 09 §10.2 (cached in Kpi::tiles()).
     *
     * @return list<array{key: string, unit: 'count'|'minutes'|'percent', value: int|float|null, previous: int|float|null, series: list<int|float|null>}>
     */
    public function kpis(?CarbonImmutable $frozen = null): array
    {
        return $this->kpi->at($frozen)->tiles();
    }

    /**
     * @return array{registrations: list<array{date: string, value: int}>, qr_funnel: list<array{date: string, scans: int, registrations: int}>, top_makes: list<array{label: string, value: int}>}
     */
    public function charts(?CarbonImmutable $frozen = null): array
    {
        return $this->kpi->at($frozen)->charts();
    }

    /**
     * @return array{average: int|null, months: list<array{month: string, value: int}>}
     */
    public function dsa(?CarbonImmutable $frozen = null): array
    {
        return $this->kpi->at($frozen)->dsa();
    }
}
