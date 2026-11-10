<?php

namespace App\Actions\Admin\System;

use App\Enums\SystemEvent;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\System\JobsInspector;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Queue\Failed\FailedJobProviderInterface;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * ADM-49 "Erneut versuchen" / "Verwerfen" (`system.jobs`): up to 100 failed jobs by uuid. Retry puts each back on its queue
 * (`queue:retry`, in this process; the cron worker picks it up within the minute); forget deletes it. Unknown ids are skipped and counted.
 * Audited with the counts and the job class names, never a payload.
 *
 * @throws AuthorizationException|ValidationException
 */
class ManageFailedJobs
{
    public function __construct(private readonly FailedJobProviderInterface $failer) {}

    /**
     * @param  array<array-key, mixed>  $ids
     * @return array{done: int, missing: int}
     */
    public function retry(Staff $by, array $ids): array
    {
        StaffAtoms::ensure($by, 'system.jobs');
        [$found, $missing] = $this->resolve($ids);

        if ($found !== []) {
            Artisan::call('queue:retry', ['id' => array_keys($found)]);
        }

        Audit::record(SystemEvent::JobsRetried->value, null, after: ['count' => count($found), 'missing' => $missing, 'jobs' => array_values(array_unique($found))], actor: $by);

        return ['done' => count($found), 'missing' => $missing];
    }

    /**
     * @param  array<array-key, mixed>  $ids
     * @return array{done: int, missing: int}
     */
    public function forget(Staff $by, array $ids): array
    {
        StaffAtoms::ensure($by, 'system.jobs');
        [$found, $missing] = $this->resolve($ids);

        foreach (array_keys($found) as $uuid) {
            $this->failer->forget($uuid);
        }

        Audit::record(SystemEvent::JobsForgotten->value, null, after: ['count' => count($found), 'missing' => $missing, 'jobs' => array_values(array_unique($found))], actor: $by);

        return ['done' => count($found), 'missing' => $missing];
    }

    /**
     * @param  array<array-key, mixed>  $ids
     * @return array{0: array<string, string>, 1: int} uuid => job class name, and how many ids were not found
     */
    private function resolve(array $ids): array
    {
        Validator::make(['ids' => $ids], ['ids' => ['required', 'array', 'min:1', 'max:100'], 'ids.*' => ['string', 'uuid']])->validate();
        $found = [];

        foreach (array_unique(array_map(strval(...), $ids)) as $uuid) {
            $job = $this->failer->find($uuid);

            if ($job !== null) {
                $found[$uuid] = JobsInspector::jobName((string) ($job->payload ?? ''));
            }
        }

        return [$found, count(array_unique($ids)) - count($found)];
    }
}
