<?php

namespace App\Services\PublicPages;

use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Draws one Open Graph image, so no page view waits for GD (F4: LCP < 2.5 s). About one picture, far below the 50 s of the cron
 * worker, and idempotent: it reads the rows when it runs and draws only what is missing or outdated. One waiting job per subject;
 * the uniqueness ends when the work starts, so a change during a draw gets its own job.
 */
abstract class OgImageJob
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [60, 300];

    public int $uniqueFor = 300;

    abstract public function uniqueId(): string;

    public function handle(OgImages $images): void
    {
        $subject = $this->subject();

        if ($subject !== null) {
            $images->draw($subject);
        }
    }

    abstract protected function subject(): Vehicle|User|null;
}
