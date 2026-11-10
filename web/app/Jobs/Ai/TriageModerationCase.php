<?php

namespace App\Jobs\Ai;

use App\Models\ModerationCase;
use App\Services\Ai\Triage;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * ai.moderation_triage for a case that got a new report (AiServiceProvider): scores it again with every report so far. Unique per case
 * for 5 minutes, so a burst of reports costs one call; one try (a failed call is logged, the queue shows the case unscored, staff decide
 * anyway). At most two 8-second provider requests: well inside the 50-second worker slot.
 */
class TriageModerationCase implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 40;

    public int $uniqueFor = 300;

    public function __construct(public readonly string $caseId) {}

    public function uniqueId(): string
    {
        return $this->caseId;
    }

    public function handle(Triage $triage): void
    {
        $case = ModerationCase::query()->find($this->caseId);

        if ($case !== null) {
            $triage->scoreCase($case);
        }
    }
}
