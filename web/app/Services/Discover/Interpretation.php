<?php

namespace App\Services\Discover;

/**
 * What QueryInterpreter understood: filters under the parameter names of search/vehicles, one chip per filter, and the words left.
 */
final readonly class Interpretation
{
    /**
     * @param  array<string, mixed>  $filters
     * @param  list<InterpretationChip>  $chips
     */
    public function __construct(
        public array $filters,
        public array $chips,
        public string $remainingQ,
    ) {}
}
