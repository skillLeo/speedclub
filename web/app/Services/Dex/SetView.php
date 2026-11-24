<?php

namespace App\Services\Dex;

use App\Models\DexSet;
use Carbon\CarbonInterface;

/**
 * One set of DEX-05 for one member (GET me/dex/sets): progress, the stored completion and the binder's slots.
 */
final readonly class SetView
{
    /**
     * @param  list<array{found: bool, card: SpotCard|null, silhouette: array{make: string|null, generation: string|null}|null}>  $slots
     */
    public function __construct(
        public DexSet $set,
        public int $progress,
        public int $target,
        public ?CarbonInterface $completedAt,
        public array $slots,
    ) {}
}
