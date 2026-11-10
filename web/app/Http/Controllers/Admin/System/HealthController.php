<?php

namespace App\Http\Controllers\Admin\System;

use App\Actions\Admin\System\RunHealthChecks;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\System\HealthReport;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-48 health (spatie/laravel-health, 06 §3 System): the last stored run (every five minutes by the scheduler) with its time and the
 * status and the reason of each check in the admin's words (HealthPresenter, DQ-620/638); "Jetzt prüfen" runs them now (rate-limited on
 * the route, audited). The checks' meta never holds a secret (HealthReport).
 */
class HealthController extends Controller
{
    public function show(HealthReport $report): Response
    {
        return Inertia::render('System/Health', ['report' => fn (): array => HealthPresenter::present($report->latest())]);
    }

    public function run(Request $request, RunHealthChecks $run): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $report = $run->handle($staff);

        return back(303)->with($report['status'] === 'ok' ? 'success' : 'error', $report['status'] === 'ok' ? 'system.flash.health_ok' : 'system.flash.health_problems');
    }
}
