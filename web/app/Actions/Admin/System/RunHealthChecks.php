<?php

namespace App\Actions\Admin\System;

use App\Enums\SystemEvent;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\System\HealthReport;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Artisan;
use Spatie\Health\Commands\RunHealthChecksCommand;

/**
 * ADM-48 "Jetzt prüfen" (`system.view`): runs the health checks in this request (no shell, at most the two 3-second network checks) and
 * stores the run like the scheduled one. The controller limits how often (it is cheap, but not free).
 *
 * @throws AuthorizationException
 */
class RunHealthChecks
{
    public function __construct(private readonly HealthReport $report) {}

    /**
     * @return array{finished_at: string|null, status: 'ok'|'warning'|'failed'|'unknown', checks: list<array{name: string, label: string, status: string, summary: string, meta: array<string, mixed>}>}
     */
    public function handle(Staff $by): array
    {
        StaffAtoms::ensure($by, 'system.view');
        Artisan::call(RunHealthChecksCommand::class, ['--no-notification' => true]);
        $report = $this->report->latest();

        Audit::record(SystemEvent::HealthChecksRun->value, null, after: ['status' => $report['status']], actor: $by);

        return $report;
    }
}
