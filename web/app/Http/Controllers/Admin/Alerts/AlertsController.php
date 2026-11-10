<?php

namespace App\Http\Controllers\Admin\Alerts;

use App\Http\Controllers\Admin\Support\AlertsData;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** ADM-08: approvals waiting for me, my approved requests still executing (M3.4), cases assigned to me, system warnings, and files of my approved exports (24 h). */
class AlertsController extends Controller
{
    public function __invoke(Request $request, AlertsData $alerts): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Alerts/Index', [
            'approvals' => $alerts->approvals($staff),
            'cases' => $alerts->cases($staff),
            'warnings' => $alerts->systemWarnings($staff),
            'downloads' => $alerts->downloads($staff),
            'running' => $alerts->running($staff),
            'sections' => [
                'approvals' => $staff->can('approvals.decide'),
                'cases' => $staff->can('moderation.view'),
                'warnings' => $staff->can('audit.view') || $staff->can('system.view'),
            ],
        ]);
    }
}
