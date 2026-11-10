<?php

namespace App\Services\Notifications;

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\BuildUpdate;
use App\Models\Follow;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * One slice of a member's followers (speedclub.notifications.fanout_chunk), then the next slice as a job of its own, so a member with many
 * followers never holds the cron worker past its 50 s. Notifier groups per member and day, so a repeat of a slice changes nothing.
 */
class NotifyFollowersOfPublication implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [60, 300];

    public function __construct(
        public readonly string $actorId,
        public readonly string $vehicleId,
        // '' for a first publish.
        public readonly string $updateId,
        // The Berlin day of the publication (Y-m-d), fixed when it was queued, so a slice retried after midnight joins the same group.
        public readonly string $dayId = '',
        // '' for the first slice.
        public readonly string $afterFollowerId = '',
    ) {}

    public function handle(Notifier $notifier): void
    {
        $actor = User::query()->find($this->actorId);
        $vehicle = Vehicle::query()->find($this->vehicleId);
        $update = $this->updateId === '' ? null : BuildUpdate::query()->find($this->updateId);

        if (! $actor instanceof User || ! $vehicle instanceof Vehicle || ! $this->stillNews($actor, $vehicle, $update)) {
            return;
        }

        $chunk = max(1, config()->integer('speedclub.notifications.fanout_chunk'));
        $followerIds = Follow::query()
            ->where('followee_id', $actor->id)
            ->when($this->afterFollowerId !== '', fn ($query) => $query->where('follower_id', '>', $this->afterFollowerId))
            ->orderBy('follower_id')
            ->limit($chunk)
            ->pluck('follower_id')
            ->map(strval(...))
            ->all();

        foreach (User::query()->whereKey($followerIds)->get() as $follower) {
            $notifier->followedPublished($follower, $actor, $vehicle, $update, $this->dayId === '' ? null : $this->dayId);
        }

        if (count($followerIds) === $chunk) {
            self::dispatch($this->actorId, $this->vehicleId, $this->updateId, $this->dayId, end($followerIds));
        }
    }

    private function stillNews(User $actor, Vehicle $vehicle, ?BuildUpdate $update): bool
    {
        if ($vehicle->owner_id !== $actor->id || $vehicle->status !== VehicleStatus::Published || $vehicle->visibility !== Visibility::Public) {
            return false;
        }

        if (! $actor->isPubliclyVisible()) {
            return false;
        }

        return $this->updateId === '' || ($update instanceof BuildUpdate && ! $update->hidden && $update->getAttribute('vehicle_id') === $vehicle->id);
    }
}
