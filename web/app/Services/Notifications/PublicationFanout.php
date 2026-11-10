<?php

namespace App\Services\Notifications;

use App\Enums\Visibility;
use App\Models\BuildUpdate;
use App\Models\Vehicle;
use Closure;
use Illuminate\Support\Facades\DB;

/**
 * Tells the followers of a member about a first publish or a new build update ("followed_published"), through the cron queue after the
 * commit. The job checks again what it finds when it runs, so an update hidden or a build gone private in between reaches nobody.
 */
class PublicationFanout
{
    private static int $muted = 0;

    public function vehiclePublished(Vehicle $vehicle): void
    {
        if (self::$muted === 0 && $vehicle->visibility === Visibility::Public) {
            $day = self::day();
            DB::afterCommit(fn () => NotifyFollowersOfPublication::dispatch($vehicle->owner_id, $vehicle->id, '', $day));
        }
    }

    public function updateCreated(BuildUpdate $update): void
    {
        if (self::$muted === 0 && ! $update->hidden) {
            $vehicleId = (string) $update->getAttribute('vehicle_id');
            $ownerId = (string) Vehicle::withTrashed()->whereKey($vehicleId)->value('owner_id');

            $day = self::day();
            DB::afterCommit(fn () => NotifyFollowersOfPublication::dispatch($ownerId, $vehicleId, (string) $update->getKey(), $day));
        }
    }

    private static function day(): string
    {
        return now(config()->string('speedclub.notifications.timezone'))->toDateString();
    }

    /**
     * For seeders and imports, whose history is not news.
     *
     * @template T
     *
     * @param  Closure(): T  $work
     * @return T
     */
    public static function muted(Closure $work): mixed
    {
        self::$muted++;

        try {
            return $work();
        } finally {
            self::$muted--;
        }
    }
}
