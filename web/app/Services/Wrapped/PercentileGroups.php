<?php

namespace App\Services\Wrapped;

use Closure;
use Illuminate\Container\Attributes\Scoped;

/**
 * CR-P5G-05: the percentile card's Bundesland groups (every member's best Build Score), read once per Bundesland per generation pass
 * instead of once per member, which made a pass grow faster than linearly with the members. Only while a pass runs
 * (WrappedGenerator::run → begin/end): a single generate (the admin preview, `--user`) reads the group fresh. Scoped, so a request, a job
 * or a test never sees another one's numbers.
 */
#[Scoped]
final class PercentileGroups
{
    private bool $active = false;

    /** @var array<string, list<int>> best totals per group key, highest first */
    private array $groups = [];

    public function begin(): void
    {
        $this->active = true;
        $this->groups = [];
    }

    public function end(): void
    {
        $this->active = false;
        $this->groups = [];
    }

    /**
     * The group's best totals, highest first: from the memo during a pass, else read now.
     *
     * @param  Closure(): list<int>  $read
     * @return list<int>
     */
    public function totals(string $key, Closure $read): array
    {
        if (! $this->active) {
            return $read();
        }

        return $this->groups[$key] ??= $read();
    }
}
