<?php

namespace App\Services\Social;

use App\Enums\UserStatus;
use App\Models\Follow;
use App\Models\User;
use App\Services\Discover\MemberNameFilter;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletingScope;
use Illuminate\Pagination\AbstractCursorPaginator;

/**
 * PROF-04: who follows a member and whom the member follows. Rows are members the viewer may see: publicly visible (active,
 * verified, not deleted, as MemberStats counts them) and no block either way with the viewer. So a list can be shorter than its
 * count, and nothing tells which row is missing. Newest follow first, then the follow's id; `q` narrows by name as member search does.
 *
 * Reads `users u` joined to `follows f`, the alias MemberNameFilter expects. Each member carries `viewer_follows` (bool): whether the
 * viewer follows that row.
 */
class Connections
{
    /** The cursor's columns: aliases of f.created_at and f.id, which the paginator maps back for its where clause. */
    public const CURSOR_COLUMNS = ['followed_at', 'follow_id'];

    public function __construct(private readonly VisibleBuilds $builds) {}

    /**
     * @param  list<string>|null  $words  from SearchTerms::nameWords; null for no search
     * @return CursorPaginator<int, User>
     */
    public function followers(User $member, ?User $viewer, ?array $words, int $perPage): CursorPaginator
    {
        return $this->page($this->query('follower_id', 'followee_id', $member), $viewer, $words, $perPage);
    }

    /**
     * @param  list<string>|null  $words
     * @return CursorPaginator<int, User>
     */
    public function following(User $member, ?User $viewer, ?array $words, int $perPage): CursorPaginator
    {
        return $this->page($this->query('followee_id', 'follower_id', $member), $viewer, $words, $perPage);
    }

    /**
     * @param  'follower_id'|'followee_id'  $row  the column that holds the listed members
     * @param  'follower_id'|'followee_id'  $of  the column that holds the profile's member
     * @return Builder<User>
     */
    private function query(string $row, string $of, User $member): Builder
    {
        // SoftDeletes qualifies its column with the table name, which the alias hides: the same condition, on the alias.
        return User::query()
            ->withoutGlobalScope(SoftDeletingScope::class)
            ->from('users', 'u')
            ->join('follows as f', 'f.'.$row, '=', 'u.id')
            ->where('f.'.$of, $member->id)
            ->whereNull('u.deleted_at')
            ->where('u.status', UserStatus::Active)
            ->whereNotNull('u.email_verified_at')
            ->whereNotNull('u.username')
            ->select('u.*', 'f.created_at as followed_at', 'f.id as follow_id');
    }

    /**
     * @param  Builder<User>  $query
     * @param  list<string>|null  $words
     * @return CursorPaginator<int, User>
     */
    private function page(Builder $query, ?User $viewer, ?array $words, int $perPage): CursorPaginator
    {
        $this->builds->withoutBlocks($query->getQuery(), $viewer, 'u.id');
        $this->builds->withoutSamples($query->getQuery(), 'u.is_sample');

        if ($words !== null) {
            MemberNameFilter::apply($query->getQuery(), $words);
        }

        /** @var AbstractCursorPaginator<int, User> $page */
        $page = $query->with('avatar')
            ->orderByDesc('followed_at')
            ->orderByDesc('follow_id')
            ->cursorPaginate($perPage, ['*'], 'cursor');
        $page->withQueryString();

        $this->markFollowed($viewer, $page->items());

        /** @var CursorPaginator<int, User> $page */
        return $page;
    }

    /**
     * One query for the page, not one per row.
     *
     * @param  array<int, User>  $members
     */
    private function markFollowed(?User $viewer, array $members): void
    {
        $followed = $viewer === null || $members === [] ? [] : array_flip(
            Follow::query()
                ->where('follower_id', $viewer->id)
                ->whereIn('followee_id', array_map(fn (User $member): string => $member->id, $members))
                ->pluck('followee_id')
                ->all()
        );

        foreach ($members as $member) {
            $member->setAttribute('viewer_follows', isset($followed[$member->id]));
        }
    }
}
