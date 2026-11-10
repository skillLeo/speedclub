<?php

namespace App\Services\Discover;

use App\Models\Make;

/**
 * DISC-03 (MakePages).
 */
final readonly class MakePage
{
    /**
     * @param  list<ModelCount>  $models
     */
    public function __construct(
        public Make $make,
        public int $count,
        public array $models,
    ) {}
}
