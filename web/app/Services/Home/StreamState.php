<?php

namespace App\Services\Home;

/**
 * Where a Für dich page ends, carried in its cursor, so the next page continues the same stream: the ranking position, the builds held
 * back for the diversity rule, the owner run, the update stream and what the page above the stream already showed.
 */
final class StreamState
{
    /**
     * @param  array{0: string, 1: string, 2: string}|null  $position  [score, changed at, vehicle id] of the last build read
     * @param  list<string>  $deferred  builds read but not shown yet, in the stream's order
     * @param  array{0: string, 1: string}|null  $updatePosition  [created_at, update id] of the last update row shown or skipped
     * @param  list<string>  $recent  the last vehicle cards (update_every of them)
     * @param  list<string>  $excludedVehicles  featured and the first Neue Builds, shown above the stream
     * @param  list<string>  $excludedUpdates  the Build-Updates module, shown above the stream
     * @param  int  $epoch  the ranking epoch the first page read (HomeRanking); every page reads its scores
     */
    public function __construct(
        public ?array $position = null,
        public array $deferred = [],
        public ?string $lastOwner = null,
        public int $run = 0,
        public ?array $updatePosition = null,
        public int $sinceUpdate = 0,
        public array $recent = [],
        public array $excludedVehicles = [],
        public array $excludedUpdates = [],
        public int $epoch = 0,
    ) {}
}
