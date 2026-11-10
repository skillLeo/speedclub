<?php

namespace App\Jobs\Catalog;

/**
 * The cron worker gives a job 50 s (05_ARCHITECTURE §13); the catalogue jobs stop after BUDGET_SECONDS and queue their own
 * continuation, so a large merge or import never meets the timeout half-way through a step.
 */
final class TimeBudget
{
    public const BUDGET_SECONDS = 35;

    private readonly int $deadline;

    public function __construct(int $seconds = self::BUDGET_SECONDS)
    {
        $this->deadline = hrtime(true) + $seconds * 1_000_000_000;
    }

    public function spent(): bool
    {
        return hrtime(true) >= $this->deadline;
    }
}
