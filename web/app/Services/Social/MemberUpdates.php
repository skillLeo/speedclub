<?php

namespace App\Services\Social;

use App\Models\BuildUpdate;
use App\Models\User;
use App\Services\Discover\VisibleBuilds;
use App\Services\Home\HomeModules;
use Illuminate\Pagination\CursorPaginator;
use Illuminate\Support\Facades\DB;

/**
 * PROF-01/02 "Updates" (DQ-1093): a member's build updates across their builds, newest first, as the reader may see them in a list:
 * public, published builds only (an unlisted build is reachable by link and QR alone), hidden updates left out, followers-only updates
 * for the owner and followers (BuildUpdate::audienceFor), no block either way, samples only while shown (VisibleBuilds::updates).
 */
final class MemberUpdates
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly HomeModules $modules,
    ) {}

    /**
     * @return CursorPaginator<int, BuildUpdate>
     */
    public function page(?User $reader, User $member, int $perPage): CursorPaginator
    {
        $hits = $this->builds->updates($reader, straight: false)
            ->where('vs.owner_id', $member->id)
            ->select(['bu.id as id', 'bu.created_at as created_at']);

        /** @var CursorPaginator<int, object> $page */
        $page = DB::query()->fromSub($hits, 'hits')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($perPage, ['*'], 'cursor');

        $updates = $this->modules->updates(array_values($page->getCollection()->map(fn (object $row): string => (string) VisibleBuilds::column($row, 'id'))->all()));

        $page->setCollection($page->getCollection()
            ->map(fn (object $row): ?BuildUpdate => $updates[(string) VisibleBuilds::column($row, 'id')] ?? null)
            ->filter()
            ->values());
        $page->withQueryString();

        /** @var CursorPaginator<int, BuildUpdate> $page */
        return $page;
    }
}
