<?php

namespace App\Services\Discover;

use App\Models\Generation;

/**
 * A generation with its visible builds (MakePages).
 */
final readonly class GenerationCount
{
    public function __construct(
        public Generation $generation,
        public int $count,
    ) {}
}
