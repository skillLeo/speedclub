<?php

namespace App\Services\Forum;

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Enums\UserStatus;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * Who sees what in the forum (m5.8-contract §2, §3), the one rule every list and policy uses:
 *
 * - a thread is listed while published, in an open category, of an author anybody may see (active, verified, not deleted; a sample
 *   member only while editorial_samples is on) or of a hard-deleted author (D8), with no block between author and reader;
 * - a post is shown while published, of a visible author, no block either way, samples as above.
 *
 * Plain NOT EXISTS / EXISTS, no JSON functions (MySQL 8 and MariaDB 10.6).
 */
final class ForumVisibility
{
    /** @var list<int>|null */
    private ?array $openCategories = null;

    public function __construct(private readonly VisibleBuilds $builds) {}

    /**
     * $statuses: published by default; the policy also asks for a merged thread (the pointer to its target).
     *
     * @return Builder<ForumThread>
     */
    public function threads(?User $viewer, ForumThreadStatus ...$statuses): Builder
    {
        $statuses = $statuses === [] ? [ForumThreadStatus::Published] : $statuses;
        $query = ForumThread::query()
            ->whereIn('forum_threads.status', array_map(fn (ForumThreadStatus $status): string => $status->value, $statuses))
            ->whereIn('forum_threads.category_id', $this->openCategoryIds())
            ->where(fn (Builder $author) => $author->whereNull('forum_threads.user_id')
                ->orWhereExists(fn (QueryBuilder $users) => $this->visibleAuthor($users, 'forum_threads.user_id')));

        $this->builds->withoutSamples($query->getQuery(), 'forum_threads.is_sample');
        $this->builds->withoutBlocks($query->getQuery(), $viewer, 'forum_threads.user_id');

        return $query;
    }

    /**
     * Narrows a post query to the posts $viewer may see. $table: the posts table's name or alias in $query (an EXISTS sub-query uses one).
     *
     * @param  Builder<ForumPost>|QueryBuilder  $query
     */
    public function posts(Builder|QueryBuilder $query, ?User $viewer, string $table = 'forum_posts'): void
    {
        $base = $query instanceof Builder ? $query->getQuery() : $query;
        $base->where($table.'.status', ForumPostStatus::Published->value)
            ->whereNull($table.'.deleted_at')
            ->whereExists(fn (QueryBuilder $users) => $this->visibleAuthor($users, $table.'.user_id'));
        $this->builds->withoutSamples($base, $table.'.is_sample');
        $this->builds->withoutBlocks($base, $viewer, $table.'.user_id');
    }

    public function samplesVisible(): bool
    {
        return $this->builds->samplesVisible();
    }

    /**
     * Active categories under an active parent (or top-level), once per request.
     *
     * @return list<int>
     */
    public function openCategoryIds(): array
    {
        if ($this->openCategories === null) {
            $rows = ForumCategory::query()->get(['id', 'parent_id', 'is_active'])->keyBy('id');
            $this->openCategories = array_values($rows->filter(fn (ForumCategory $category): bool => $category->is_active
                && ($category->parent_id === null || $rows->get($category->parent_id)?->is_active === true))->keys()->map(intval(...))->all());
        }

        return $this->openCategories;
    }

    /**
     * Forgets the memo (after a category write in the same request).
     */
    public function flush(): void
    {
        $this->openCategories = null;
    }

    private function visibleAuthor(QueryBuilder $users, string $column): QueryBuilder
    {
        $users->selectRaw('1')->from('users', 'fu')->whereColumn('fu.id', $column)
            ->whereNull('fu.deleted_at')
            ->where('fu.status', UserStatus::Active->value)
            ->whereNotNull('fu.email_verified_at');

        if (! $this->builds->samplesVisible()) {
            $users->where('fu.is_sample', false);
        }

        return $users;
    }
}
