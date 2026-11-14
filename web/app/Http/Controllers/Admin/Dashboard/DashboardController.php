<?php

namespace App\Http\Controllers\Admin\Dashboard;

use App\Http\Controllers\Admin\Support\DashboardData;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-06. Queues come with the page (they are the reason to open it); KPIs, charts and the DSA box follow as deferred props, each
 * rescued on its own, so one failing source shows an error in its section and leaves the rest (partial failure).
 */
class DashboardController extends Controller
{
    public function __invoke(Request $request, DashboardData $data): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        // DQ-1196: the visual matrix freezes the day windows with `?qaNow=` (non-production only); null = the real clock.
        $frozen = QaClock::frozen($request);

        return Inertia::render('Dashboard/Index', [
            'queues' => $data->queues($staff),
            'firstRun' => ! User::query()->exists(),
            'canAnalytics' => $staff->can('analytics.view'),
            'kpis' => Inertia::defer(fn (): array => $staff->can('analytics.view') ? $data->kpis($frozen) : [], 'kpis', rescue: true),
            'charts' => Inertia::defer(fn (): ?array => $staff->can('analytics.view') ? $data->charts($frozen) : null, 'charts', rescue: true),
            'dsa' => Inertia::defer(fn (): ?array => $staff->can('analytics.view') ? $data->dsa($frozen) : null, 'dsa', rescue: true),
        ]);
    }
}
