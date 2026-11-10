<?php

namespace App\Services\Notifications;

use App\Enums\NotificationType;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\BuildUpdate;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Pagination\AbstractCursorPaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * HOME-02: the member's rows, newest first (created_at is a row's latest event). A row of a type with actors shows only actors the member
 * may see now (active, verified, not deleted, no block either way); with none left, the row is left out, and so is it from the unread
 * count. Plain joins and NOT EXISTS, no JSON functions; the top actors per row by ROW_NUMBER() (MySQL 8, MariaDB 10.2+).
 */
class NotificationFeed
{
    public function __construct(private readonly VisibleBuilds $builds) {}

    /**
     * @return CursorPaginator<int, Notification>
     */
    public function page(User $member, int $perPage): CursorPaginator
    {
        /** @var AbstractCursorPaginator<int, Notification> $page */
        $page = $this->visible($member)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($perPage, ['*'], 'cursor');

        $this->hydrate($member, $page->getCollection());
        $page->withQueryString();

        /** @var CursorPaginator<int, Notification> $page */
        return $page;
    }

    public function unreadCount(User $member): int
    {
        return $this->visible($member)->whereNull('read_at')->count();
    }

    /**
     * The member's row, or null for anybody else's id and for a row the list leaves out.
     */
    public function find(User $member, string $id): ?Notification
    {
        $row = $this->visible($member)->whereKey($id)->first();

        if ($row !== null) {
            $this->hydrate($member, collect([$row]));
        }

        return $row;
    }

    /**
     * @return Builder<Notification>
     */
    public function visible(User $member): Builder
    {
        $withActors = array_values(array_map(
            fn (NotificationType $type): string => $type->value,
            array_filter(NotificationType::cases(), fn (NotificationType $type): bool => $type->hasActors()),
        ));

        return Notification::query()
            ->where('notifiable_id', $member->id)
            ->where(fn (Builder $query) => $query
                ->whereNotIn('type', $withActors)
                ->orWhereExists(fn (QueryBuilder $actors) => $this->actors($actors, $member)->whereColumn('na.notification_id', 'notifications.id')));
    }

    /**
     * Loads what NotificationResource reads: shown actors (newest first, at most actors_shown), their count, the vehicle and whether the
     * member may still see it.
     *
     * @param  Collection<int, Notification>  $rows
     */
    public function hydrate(User $member, Collection $rows): void
    {
        $ids = $rows->pluck('id')->map(strval(...))->all();

        if ($ids === []) {
            return;
        }

        $shown = config()->integer('speedclub.notifications.actors_shown');
        $ranked = $this->actors(DB::query(), $member)
            ->whereIn('na.notification_id', $ids)
            ->select('na.notification_id', 'na.actor_id')
            ->selectRaw('ROW_NUMBER() OVER (PARTITION BY na.notification_id ORDER BY na.created_at DESC, na.actor_id DESC) AS position')
            ->selectRaw('COUNT(*) OVER (PARTITION BY na.notification_id) AS total');
        $top = DB::query()->fromSub($ranked, 'ranked')->where('position', '<=', $shown)->orderBy('position')->get();

        $members = User::query()->whereKey($top->pluck('actor_id')->unique()->values()->all())->with('avatar')->get()->keyBy('id');
        $vehicles = $this->vehicles($member, $rows);
        $visibleUpdates = $this->visibleUpdates($rows);

        foreach ($rows as $row) {
            $mine = $top->where('notification_id', $row->id);
            $actors = $mine->map(fn (object $line): ?User => $members->get((string) VisibleBuilds::column($line, 'actor_id')))->filter()->values();
            $total = $mine->isEmpty() ? 0 : (int) VisibleBuilds::column((object) $mine->first(), 'total');
            $vehicle = $row->vehicle_id === null ? null : ($vehicles[$row->vehicle_id] ?? null);

            $row->setRelation('shownActors', $actors);
            $row->visibleActorCount = $row->type->hasActors() ? $total : $row->actor_count;
            $row->setRelation('vehicle', $vehicle);
            $updateIds = is_array($row->data['update_ids'] ?? null) ? $row->data['update_ids'] : [];
            $row->visibleUpdateIds = array_values(array_filter($updateIds, fn (mixed $id): bool => is_string($id) && isset($visibleUpdates[$id])));
        }
    }

    /**
     * Updates of followed_published rows that are still shown (M2.2 review #11): one query per page.
     *
     * @param  Collection<int, Notification>  $rows
     * @return array<string, true>
     */
    private function visibleUpdates(Collection $rows): array
    {
        $ids = $rows->flatMap(fn (Notification $row): array => is_array($row->data['update_ids'] ?? null) ? $row->data['update_ids'] : [])
            ->filter(fn (mixed $id): bool => is_string($id))->unique()->values()->all();

        if ($ids === []) {
            return [];
        }

        return array_fill_keys(BuildUpdate::query()->whereKey($ids)->where('hidden', false)->pluck('id')->map(strval(...))->all(), true);
    }

    /**
     * Actors of rows ("na") the member may see now.
     */
    private function actors(QueryBuilder $query, User $member): QueryBuilder
    {
        $query->from('notification_actors', 'na')
            ->join('users as au', 'au.id', '=', 'na.actor_id')
            ->whereNull('au.deleted_at')
            ->where('au.status', UserStatus::Active->value)
            ->whereNotNull('au.email_verified_at');

        return $this->builds->withoutBlocks($query, $member, 'na.actor_id');
    }

    /**
     * The vehicles of the page the member may see now, as VehiclePolicy::view decides, in one query (M2.2 review #14): the own ones
     * unless deleted; others published, public or unlisted, of an active verified owner, no block either way.
     *
     * @param  Collection<int, Notification>  $rows
     * @return array<string, Vehicle>
     */
    private function vehicles(User $member, Collection $rows): array
    {
        $ids = $rows->pluck('vehicle_id')->filter()->unique()->values()->all();

        if ($ids === []) {
            return [];
        }

        $query = Vehicle::query()
            ->whereKey($ids)
            ->where(fn (Builder $visible) => $visible
                ->where('vehicles.owner_id', $member->id)
                ->orWhere(fn (Builder $others) => $others
                    ->where('vehicles.status', VehicleStatus::Published->value)
                    ->whereIn('vehicles.visibility', [Visibility::Public->value, Visibility::Unlisted->value])
                    ->whereHas('owner', fn (Builder $owner) => $owner->whereNull('deleted_at')->where('status', UserStatus::Active->value)->whereNotNull('email_verified_at'))));
        $this->builds->withoutBlocks($query->getQuery(), $member, 'vehicles.owner_id');

        return $query
            ->with(['make', 'vehicleModel', 'generation', 'cover', 'media', 'owner'])
            ->get()
            ->keyBy('id')
            ->all();
    }
}
