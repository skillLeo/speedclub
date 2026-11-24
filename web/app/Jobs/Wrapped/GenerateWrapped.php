<?php

namespace App\Jobs\Wrapped;

use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedGenerator;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * M5.9e (m5.9e contract §2): one budgeted pass of a season's generation (WrappedGenerator::run: chunked by member id, stops after
 * `wrapped.seconds` ≤ 50 s, resumes at its cursor). The nightly command runs it inline through the scheduler or the cron URL; staff or
 * a deploy can queue it on demand. When the pass is not done it queues the next one, so an on-demand run finishes on its own.
 * Idempotent: a repeated pass writes the same rows. Unique until it starts, so the pass it queues itself is not dropped.
 */
final class GenerateWrapped implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 55;

    public int $uniqueFor = 600;

    /**
     * Ids only (GarageSecurityAuditTest "queued jobs"): the season key (`2027-saison`) and the run key (WrappedGenerator::runKey: the release moment, or `manual`).
     */
    public function __construct(public readonly string $seasonId, public readonly string $runId) {}

    public function uniqueId(): string
    {
        return 'wrapped:'.$this->seasonId.':'.$this->runId;
    }

    /**
     * @return array{done: bool, members: int, written: int}|null
     */
    public function handle(WrappedGenerator $generator): ?array
    {
        $result = $generator->run(Season::from($this->seasonId), $this->runId);

        if ($result !== null && ! $result['done']) {
            self::dispatch($this->seasonId, $this->runId)->delay(now()->addSeconds(5));
        }

        return $result;
    }
}
