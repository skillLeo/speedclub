<?php

namespace App\Services\Discover;

/**
 * One value of a facet group: "BMW (12)".
 */
final readonly class Facet
{
    public function __construct(
        public string $value,
        public string $label,
        public int $count,
    ) {}
}
