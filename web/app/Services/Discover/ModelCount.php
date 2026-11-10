<?php

namespace App\Services\Discover;

use App\Models\VehicleModel;

/**
 * A model with its visible builds and generations (MakePages).
 */
final readonly class ModelCount
{
    /**
     * @param  list<GenerationCount>  $generations
     */
    public function __construct(
        public VehicleModel $model,
        public int $count,
        public array $generations,
    ) {}
}
