<?php

namespace App\Services\Notifications;

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\BuildUpdate;
use App\Models\Follow;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleFollow;
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

    private const VEHICLE_PHASE = 'v:';

    public function handle(Notifier $notifier): void
    {
        $actor = User::query()->find($this->actorId);
        $vehicle = Vehicle::query()->find($this->vehicleId);
        $update = $this->updateId === '' ? null : BuildUpdate::query()->find($this->updateId);

        if (! $actor instanceof User || ! $vehicle instanceof Vehicle || ! $this->stillNews($actor, $vehicle, $update)) {
            return;
        }

        $chunk = max(1, config()->integer('speedclub.notifications.fanout_chunk'));

        // M4.11 (09 §8.6): after the member's followers, the build's own followers who do not follow the member ("v:" slices).
        if (str_starts_with($this->afterFollowerId, self::VEHICLE_PHASE)) {
            $this->vehicleFollowers($notifier, $actor, $vehicle, $update, $chunk, substr($this->afterFollowerId, strlen(self::VEHICLE_PHASE)));

            return;
        }

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
        } elseif (VehicleFollow::query()->where('vehicle_id', $vehicle->id)->exists()) {
            self::dispatch($this->actorId, $this->vehicleId, $this->updateId, $this->dayId, self::VEHICLE_PHASE);
        }
    }

    private function vehicleFollowers(Notifier $notifier, User $actor, Vehicle $vehicle, ?BuildUpdate $update, int $chunk, string $after): void
    {
        $followerIds = VehicleFollow::query()
            ->where('vehicle_id', $vehicle->id)
            ->when($after !== '', fn ($query) => $query->where('user_id', '>', $after))
            ->whereNotExists(fn ($member) => $member->selectRaw('1')->from('follows')->whereColumn('follows.follower_id', 'vehicle_follows.user_id')->where('follows.followee_id', $actor->id))
            ->orderBy('user_id')
            ->limit($chunk)
            ->pluck('user_id')
            ->map(strval(...))
            ->all();

        foreach (User::query()->whereKey($followerIds)->get() as $follower) {
            $notifier->followedPublished($follower, $actor, $vehicle, $update, $this->dayId === '' ? null : $this->dayId);
        }

        if (count($followerIds) === $chunk) {
            self::dispatch($this->actorId, $this->vehicleId, $this->updateId, $this->dayId, self::VEHICLE_PHASE.end($followerIds));
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

        if ($this->updateId === '') {
            return true;
        }

        // M4.11: an update posted without text, photos or mods (UPD-01 adds the photos right after) is no news yet.
        return $update instanceof BuildUpdate && ! $update->hidden && $update->getAttribute('vehicle_id') === $vehicle->id
            && (! $update->type->isAuthored() || trim((string) $update->getAttribute('note')) !== '' || $update->photos()->exists() || $update->modifications()->exists());
    }
}
