<?php

namespace App\Jobs\Badges;

use App\Models\User;
use App\Services\Badges\BadgeAwarder;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * M5.9d: checks one member's badges after an action (BadgeAwarder::queue). Unique per member until it starts, so a burst of actions is
 * one check; idempotent, a few queries per metric the active badges name.
 */
final class EvaluateBadges implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    public int $uniqueFor = 600;

    public function __construct(public readonly string $userId) {}

    public function uniqueId(): string
    {
        return 'badges:'.strtolower($this->userId);
    }

    public function handle(BadgeAwarder $awarder): void
    {
        $user = User::query()->find($this->userId);

        if ($user instanceof User) {
            $awarder->evaluate($user);
        }
    }
}
