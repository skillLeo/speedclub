<?php

namespace App\Http\Controllers\Admin\Support;

use App\Models\Staff;
use App\Services\Admin\Kpi;

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
        return $this->kpi->queues($staff);
    }

    /**
     * @return list<array{key: string, value: int, previous: int|null, series: list<int>}>
     */
    public function kpis(): array
    {
        return $this->kpi->kpis();
    }

    /**
     * @return array{registrations: list<array{date: string, value: int}>, qr_funnel: list<array{date: string, scans: int, registrations: int}>, top_makes: list<array{label: string, value: int}>}
     */
    public function charts(): array
    {
        return $this->kpi->charts();
    }

    /**
     * @return array{average: int|null, months: list<array{month: string, value: int}>}
     */
    public function dsa(): array
    {
        return $this->kpi->dsa();
    }
}
