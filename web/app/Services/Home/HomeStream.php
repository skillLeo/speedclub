<?php

namespace App\Services\Home;

use App\Enums\ErrorCode;
use App\Enums\FeedItemType;
use App\Exceptions\ApiException;
use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Database\Query\Builder;
use Illuminate\Pagination\AbstractCursorPaginator;
use Illuminate\Pagination\CursorPaginator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * GET feed (M2.2): "Für dich", the ranked stream below the FS-2 modules, and "Folge ich", the chronological stream of followed members.
 */
class HomeStream
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly HomeModules $modules,
        private readonly HomeRanking $ranking,
    ) {}

    /**
     * $state null starts the stream: what the page above shows (the featured hero, the first two Neue Builds, the Build-Updates module)
     * is left out of it.
     */
    public function forYou(?User $viewer, ?StreamState $state, int $perPage): FeedPage
    {
        $ranking = $this->ranking->state();

        if ($state === null) {
            $state = $this->start($viewer);
            $state->epoch = $ranking['epoch'];
        } elseif (! ($state->epoch === $ranking['epoch'] || ($state->epoch === $ranking['epoch'] - 1 && ! $ranking['writing']))) {
            // The scores this cursor paged on are gone: start over rather than skip or repeat builds.
            throw new ApiException(ErrorCode::FeedStale);
        }

        $source = new RankedBuilds($this->builds, $viewer, HomeRanking::column($state->epoch));
        $page = StreamAssembler::fromConfig()->page($source, $state, $perPage);

        $vehicleIds = [];
        $updateIds = [];

        foreach ($page['items'] as $item) {
            if ($item instanceof StreamVehicle) {
                $vehicleIds[] = $item->id;
            } else {
                $updateIds[] = $item->id;
            }
        }

        $vehicles = $this->builds->vehicles($vehicleIds);
        $updates = $this->modules->updates($updateIds);
        $items = [];

        foreach ($page['items'] as $item) {
            if ($item instanceof StreamVehicle && isset($vehicles[$item->id])) {
                $items[] = new FeedItem(FeedItemType::Vehicle, $item->id, $vehicles[$item->id], null);
            } elseif ($item instanceof StreamUpdate && isset($updates[$item->id])) {
                $items[] = new FeedItem(FeedItemType::Update, $item->id, null, $updates[$item->id]);
            }
        }

        return new FeedPage($items, $page['state'] === null ? null : StreamCursor::encode($page['state']), $perPage);
    }

    /**
     * First publishes of followed members' public builds and their visible build updates, newest first. Empty on the first page: the
     * suggestions come along.
     */
    public function following(User $viewer, int $perPage): FeedPage
    {
        // Each branch is bounded by the cursor and limited to a page itself (M2.2 review #15), so the union never materialises every
        // followed build and update; the outer cursor then merges the two.
        $cursor = CursorPaginator::resolveCurrentCursor('cursor');
        $after = $cursor === null ? null : [(string) $cursor->parameter('at'), (string) $cursor->parameter('id')];
        $bound = fn (Builder $query, string $at, string $id): Builder => $after === null ? $query : $query->where(fn (Builder $range) => $range
            ->where($at, '<', $after[0])
            ->orWhere(fn (Builder $tie) => $tie->where($at, '=', $after[0])->where($id, '<', $after[1])));

        // M4.11 (09 §8.6): followed members and followed builds; EXISTS, not a join, so a build of a followed member that is also
        // followed by itself shows once.
        $followed = fn (Builder $query): Builder => $query->where(fn (Builder $either) => $either
            ->whereExists(fn (Builder $members) => $members->selectRaw('1')->from('follows', 'f')->where('f.follower_id', $viewer->id)->whereColumn('f.followee_id', 'vs.owner_id'))
            ->orWhereExists(fn (Builder $builds) => $builds->selectRaw('1')->from('vehicle_follows', 'vf')->where('vf.user_id', $viewer->id)->whereColumn('vf.vehicle_id', 'vs.vehicle_id')));

        $vehicles = $bound($followed($this->builds->query($viewer, fromSearch: false))
            ->whereNotNull('v.published_at')
            ->selectRaw("v.published_at as at, 'vehicle' as kind, v.id as id"), 'v.published_at', 'v.id')
            ->orderByDesc('v.published_at')
            ->orderByDesc('v.id')
            ->limit($perPage + 1);
        $updates = $bound($followed($this->builds->updates($viewer, straight: false))
            ->selectRaw("bu.created_at as at, 'update' as kind, bu.id as id"), 'bu.created_at', 'bu.id')
            ->orderByDesc('bu.created_at')
            ->orderByDesc('bu.id')
            ->limit($perPage + 1);

        /** @var AbstractCursorPaginator<int, object> $page */
        $page = DB::query()->fromSub($vehicles->unionAll($updates), 'items')
            ->orderByDesc('at')
            ->orderByDesc('id')
            ->cursorPaginate($perPage, ['*'], 'cursor');
        $rows = $page->getCollection();

        $kind = fn (object $row): string => (string) VisibleBuilds::column($row, 'kind');
        $id = fn (object $row): string => (string) VisibleBuilds::column($row, 'id');
        $loadedVehicles = $this->builds->vehicles(array_values($rows->filter(fn (object $row): bool => $kind($row) === 'vehicle')->map($id)->all()));
        $loadedUpdates = $this->modules->updates(array_values($rows->filter(fn (object $row): bool => $kind($row) === 'update')->map($id)->all()));

        $items = [];

        foreach ($rows as $row) {
            $at = Carbon::parse((string) VisibleBuilds::column($row, 'at'))->format('Y-m-d H:i:s');
            $vehicle = $loadedVehicles[$id($row)] ?? null;
            $update = $loadedUpdates[$id($row)] ?? null;

            if ($kind($row) === 'vehicle' && $vehicle instanceof Vehicle) {
                $items[] = new FeedItem(FeedItemType::Vehicle, $id($row), $vehicle, null, $at);
            } elseif ($kind($row) === 'update' && $update instanceof BuildUpdate) {
                $items[] = new FeedItem(FeedItemType::Update, $id($row), null, $update, $at);
            }
        }

        // The cursor reads at and id from the last item; the rows of the page hold both.
        $page->setCollection(collect($items));
        $next = $items === [] ? null : $page->nextCursor()?->encode();
        $first = $page->cursor() === null && $items === [];

        return new FeedPage($items, $next, $perPage, $first ? $this->modules->suggestions($viewer) : null);
    }

    private function start(?User $viewer): StreamState
    {
        // HOME-01 shows the first featured build as the hero and the first two Neue Builds; the other featured slots are not on the page,
        // so they stay in the stream. M4.8: the 2.0 Home has no Build-Updates module any more, so its updates belong to the stream again.
        return new StreamState(excludedVehicles: $this->modules->shownAbove($viewer), excludedUpdates: []);
    }
}
