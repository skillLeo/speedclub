<?php

namespace App\Services\Notifications;

use App\Enums\NotificationType;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\BuildUpdate;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Pagination\AbstractCursorPaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

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
    public function page(User $member, int $perPage, ?string $category = null): CursorPaginator
    {
        /** @var AbstractCursorPaginator<int, Notification> $page */
        $page = $this->visible($member)
            ->when($category !== null, fn (Builder $query) => $query->whereIn('type', NotificationType::inCategory((string) $category)))
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
        $this->mainVehicleCovers($member, $members);
        $vehicles = $this->vehicles($member, $rows);
        $visibleUpdates = $this->visibleUpdates($rows);
        $events = $this->events($member, $rows);

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
            $eventId = $row->data['event_id'] ?? null;
            $row->setRelation('event', is_string($eventId) ? ($events[$eventId] ?? null) : null);
        }
    }

    /**
     * M4.12: the events of event rows the member may still see (EventPolicy::view, so a draft, a hidden sample or a blocked organiser's
     * event is null and the row opens HOME-02). One query per page.
     *
     * @param  Collection<int, Notification>  $rows
     * @return array<string, Event>
     */
    private function events(User $member, Collection $rows): array
    {
        $ids = $rows->map(fn (Notification $row): mixed => $row->data['event_id'] ?? null)->filter(fn (mixed $id): bool => is_string($id))->unique()->values()->all();

        if ($ids === []) {
            return [];
        }

        $gate = Gate::forUser($member);

        return Event::query()->whereKey($ids)->with('organiser')->get()
            ->filter(fn (Event $event): bool => $gate->allows('view', $event))
            ->keyBy(fn (Event $event): string => $event->id)
            ->all();
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
        // 09 §8.19: a sample actor ("@sebastian.demo folgt dir") disappears with the samples.
        $this->builds->withoutSamples($query, 'au.is_sample');

        return $this->builds->withoutBlocks($query, $member, 'na.actor_id');
    }

    /**
     * M4.8: the cover of each actor's main build (the car badge on the avatar), only a build the member may see (VisibleBuilds: blocks,
     * private builds, hidden samples); an actor without one gets null. Two queries per page.
     *
     * @param  \Illuminate\Database\Eloquent\Collection<string, User>  $actors
     */
    private function mainVehicleCovers(User $member, \Illuminate\Database\Eloquent\Collection $actors): void
    {
        if ($actors->isEmpty()) {
            return;
        }

        $mains = $this->builds->query($member)->whereIn('vs.owner_id', $actors->keys()->all())->where('v.is_main', true)
            ->pluck('vs.vehicle_id', 'vs.owner_id')->map(strval(...))->all();
        $vehicles = $this->builds->vehicles(array_values($mains));
        $presenter = app(VehiclePresenter::class);

        foreach ($actors as $id => $actor) {
            $vehicle = isset($mains[$id]) ? ($vehicles[$mains[$id]] ?? null) : null;
            $actor->setRelation('mainVehicleCover', $vehicle instanceof Vehicle ? $presenter->cover($vehicle, false) : null);
        }
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
                    // As VehiclePolicy::view: another member's sample build is hidden while editorial_samples is off.
                    ->when(! $this->builds->samplesVisible(), fn (Builder $hidden) => $hidden->where('vehicles.is_sample', false))
                    ->whereHas('owner', fn (Builder $owner) => $owner->whereNull('deleted_at')->where('status', UserStatus::Active->value)->whereNotNull('email_verified_at')
                        ->when(! $this->builds->samplesVisible(), fn (Builder $hidden) => $hidden->where('is_sample', false)))));
        $this->builds->withoutBlocks($query->getQuery(), $member, 'vehicles.owner_id');

        return $query
            ->with(['make', 'vehicleModel', 'generation', 'cover', 'media', 'owner'])
            ->get()
            ->keyBy('id')
            ->all();
    }
}
