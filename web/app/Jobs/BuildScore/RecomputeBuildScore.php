<?php

namespace App\Jobs\BuildScore;

use App\Models\Vehicle;
use App\Services\Badges\BadgeAwarder;
use App\Services\BuildScore\BuildScores;
use App\Services\Progress\XpHooks;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * M5.9c (m5.9c contract §3): recomputes one vehicle's Build Score. Dispatched by BuildScores::touch() with a delay of
 * build_score.debounce_seconds and unique per vehicle until it starts, so every edit inside that window is computed in one run; an
 * edit while it runs queues the next one. Idempotent, a few queries.
 */
final class RecomputeBuildScore implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    /** A lost job never blocks the next one for longer than this. */
    public int $uniqueFor = 600;

    public function __construct(public readonly string $vehicleId) {}

    public function uniqueId(): string
    {
        return 'build-score:'.strtolower($this->vehicleId);
    }

    public function handle(BuildScores $scores): void
    {
        $scores->recompute($this->vehicleId);
        // M5.9d: XP for each documented mod of a published car (the score's own rule), and the owner's badges (Build Score, mods).
        app(XpHooks::class)->documentedMods($this->vehicleId);
        $owner = Vehicle::query()->whereKey($this->vehicleId)->value('owner_id');

        if (is_string($owner)) {
            app(BadgeAwarder::class)->queue($owner);
        }
    }
}
