<?php

namespace App\Jobs\Badges;

use App\Models\Badge;
use App\Services\Badges\BadgesNightly;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Foundation\Queue\Queueable;

/**
 * M5.9d admin "Jetzt anwenden" (App\Actions\Admin\Badges\ApplyBadge): awards one badge to every member who reached it, in slices of at
 * most `badges.seconds`; a slice that runs out of time queues the next one at its cursor. Idempotent (an earned badge stays as it is),
 * no push (the toast shows it in the app). An inactive badge stops the walk.
 */
final class ApplyBadgeSlice implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 55;

    /**
     * @param  string  $badgeId  the badge's key
     * @param  string  $cursorId  the last member id done, '' to start
     */
    public function __construct(public readonly string $badgeId, public readonly string $cursorId = '') {}

    public function handle(BadgesNightly $walker): void
    {
        $badge = Badge::query()->whereKey($this->badgeId)->where('active', true)->first();

        if (! $badge instanceof Badge) {
            return;
        }

        $result = $walker->walk(new Collection([$badge]), $this->cursorId === '' ? null : $this->cursorId, 'apply');

        if ($result['cursor'] !== null) {
            self::dispatch($this->badgeId, $result['cursor']);
        }
    }
}
