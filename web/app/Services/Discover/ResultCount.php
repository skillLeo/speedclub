<?php

namespace App\Services\Discover;

/**
 * The total of a search tab, counted up to speedclub.search.count_cap (SEC-M18-01). $capped: there are more than $count, shown as
 * "1000+".
 */
final readonly class ResultCount
{
    public function __construct(
        public int $count,
        public bool $capped,
    ) {}
}
