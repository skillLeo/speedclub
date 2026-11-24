<?php

namespace App\Services\Dex;

/**
 * A member's live progress in one set. vehicleIds and spotIds list the found cars in the order they were found (spotIds: the member's
 * first counted spot of each); for a JDM set, slotSpots holds one entry per generation of the rule (null while unfound) and silhouettes
 * the make and generation names of each slot.
 */
final readonly class SetProgress
{
    /**
     * @param  list<string>  $vehicleIds
     * @param  list<string>  $spotIds
     * @param  list<string|null>|null  $slotSpots
     * @param  list<array{make: string|null, generation: string|null}>|null  $silhouettes
     */
    public function __construct(
        public int $progress,
        public int $target,
        public string $period,
        public bool $completed,
        public array $vehicleIds,
        public array $spotIds,
        public ?array $slotSpots = null,
        public ?array $silhouettes = null,
    ) {}
}
