<?php

namespace App\Http\Controllers\Admin\System;

use App\Actions\Admin\System\ManageFailedJobs;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\System\JobsInspector;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\Health\Checks\Checks\ScheduleCheck;

/**
 * ADM-49 jobs (06 §3 System, m3.6 §1): failed and pending jobs by class name, queue, attempts and time, the exception's class only; never
 * a payload. Retry and forget (system.jobs, up to 100 at once, audited with counts and class names), with the scheduler's heartbeat for
 * "when does the worker pick it up".
 */
class JobsController extends Controller
{
    public function index(Request $request, JobsInspector $jobs): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');
        $check = ScheduleCheck::new();
        $heartbeat = Cache::store($check->getCacheStoreName())->get($check->getCacheKey());

        return Inertia::render('System/Jobs', [
            'failed' => fn (): array => $jobs->failed(),
            'pending' => fn (): array => $jobs->pending(),
            'counts' => fn (): array => $jobs->counts(),
            'heartbeat' => is_numeric($heartbeat) ? CarbonImmutable::createFromTimestamp((int) $heartbeat)->toIso8601String() : null,
            'canManage' => $viewer->can('system.jobs'),
        ]);
    }

    public function retry(Request $request, ManageFailedJobs $manage): RedirectResponse
    {
        return $this->run($request, fn (Staff $staff, array $ids): array => $manage->retry($staff, $ids), 'retried');
    }

    public function forget(Request $request, ManageFailedJobs $manage): RedirectResponse
    {
        return $this->run($request, fn (Staff $staff, array $ids): array => $manage->forget($staff, $ids), 'forgotten');
    }

    /**
     * @param  \Closure(Staff, array<array-key, mixed>): array{done: int, missing: int}  $step
     */
    private function run(Request $request, \Closure $step, string $flash): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $ids = $request->input('ids');
        $result = $step($staff, is_array($ids) ? $ids : []);

        return back(303)->with('success', $result['missing'] > 0 ? "system.flash.{$flash}_partial" : "system.flash.{$flash}");
    }
}
