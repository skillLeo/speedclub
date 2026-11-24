<?php

namespace App\Services\Forum;

use App\Enums\ForumPostSort;
use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadSort;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Search\SearchTerms;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * The forum's lists (m5.8-contract §4): FOR-01/02 by sort, search, Home "Gerade im Forum", "Ähnliche Themen", the threads of a vehicle,
 * mod or product, FOR-05, and the replies of FOR-03. Cursor pages over indexed orders; ForumVisibility decides what each reader sees.
 */
final class ForumListing
{
    /** Words of a title that say nothing about the topic ("Ähnliche Themen" ignores them). */
    private const STOP_WORDS = ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder', 'mit', 'fuer', 'fur', 'von', 'vom',
        'zum', 'zur', 'bei', 'beim', 'auf', 'aus', 'ist', 'sind', 'hat', 'habe', 'ich', 'mein', 'meine', 'meinen', 'wie', 'was', 'wer', 'welche', 'welcher',
        'welches', 'gibt', 'kann', 'man', 'nicht', 'noch', 'auch', 'mal', 'frage', 'hilfe', 'the', 'and', 'for', 'with', 'how', 'what'];

    public function __construct(private readonly ForumVisibility $visibility) {}

    /**
     * The order columns of a thread list's cursor, by sort.
     *
     * @return list<string>
     */
    public static function cursorColumns(ForumThreadSort $sort): array
    {
        return match ($sort) {
            ForumThreadSort::Active => ['forum_threads.is_pinned', 'forum_threads.last_activity_at', 'forum_threads.id'],
            ForumThreadSort::New, ForumThreadSort::Unanswered => ['forum_threads.published_at', 'forum_threads.id'],
            ForumThreadSort::Solved => ['forum_threads.last_activity_at', 'forum_threads.id'],
        };
    }

    /**
     * @return CursorPaginator<int, ForumThread>
     */
    public function threads(?User $viewer, ?ForumCategory $category, ?string $tag, ForumThreadSort $sort, int $perPage): CursorPaginator
    {
        $query = $this->visibility->threads($viewer);

        if ($category instanceof ForumCategory) {
            $query->whereIn('forum_threads.category_id', [$category->id, ...$this->childIds($category)]);
        }

        if ($tag !== null && $tag !== '') {
            self::withTag($query, $tag);
        }

        return $this->sorted($this->withRow($query), $sort)->cursorPaginate($perPage)->withQueryString();
    }

    /**
     * @param  list<string>  $words  SearchTerms::queryWords
     * @return CursorPaginator<int, ForumThread>
     */
    public function search(?User $viewer, array $words, ?ForumCategory $category, ForumThreadSort $sort, int $perPage): CursorPaginator
    {
        $query = $this->visibility->threads($viewer);
        ForumSearchKeys::match($query, $words);

        if ($category instanceof ForumCategory) {
            $query->whereIn('forum_threads.category_id', [$category->id, ...$this->childIds($category)]);
        }

        return $this->sorted($this->withRow($query), $sort)->cursorPaginate($perPage)->withQueryString();
    }

    /**
     * Home "Gerade im Forum": the threads with the newest activity in the last active_days, pinned ones not preferred.
     *
     * @return Collection<int, ForumThread>
     */
    public function active(?User $viewer): Collection
    {
        return $this->withRow($this->visibility->threads($viewer))
            ->where('forum_threads.last_activity_at', '>=', now()->subDays(config()->integer('speedclub.forum.active_days')))
            ->orderByDesc('forum_threads.last_activity_at')->orderByDesc('forum_threads.id')
            ->limit(config()->integer('speedclub.forum.active_max'))
            ->get();
    }

    /**
     * FOR-04 "Ähnliche Themen": threads whose titles share the most words with $title (at least two, or the only one), then the newest.
     *
     * @return Collection<int, ForumThread>
     */
    public function similar(?User $viewer, string $title, ?ForumCategory $category): Collection
    {
        $words = array_values(array_filter(SearchTerms::queryWords($title), fn (string $word): bool => strlen($word) >= 3 && ! in_array($word, self::STOP_WORDS, true)));

        if ($words === []) {
            return new Collection;
        }

        $query = $this->withRow($this->visibility->threads($viewer));
        $score = [];
        $bindings = [];

        foreach ($words as $word) {
            $score[] = "CASE WHEN forum_threads.title_keys LIKE ? ESCAPE '!' THEN 1 ELSE 0 END";
            $bindings[] = '% '.SearchTerms::escapeLike($word).'%';
        }

        $expression = '('.implode(' + ', $score).')';
        $query->whereRaw($expression.' >= ?', [...$bindings, min(2, count($words))]);

        if ($category instanceof ForumCategory) {
            $query->orderByRaw('CASE WHEN forum_threads.category_id = ? THEN 0 ELSE 1 END', [$category->id]);
        }

        return $query->orderByRaw($expression.' DESC', $bindings)
            ->orderByDesc('forum_threads.last_activity_at')
            ->limit(config()->integer('speedclub.forum.similar_max'))
            ->get();
    }

    /**
     * Threads linked to a vehicle, a mod or a product (VEH-01 "Diskussionen zu diesem Build", mod and product pages).
     *
     * @return CursorPaginator<int, ForumThread>
     */
    public function linked(?User $viewer, string $column, string $id, int $perPage): CursorPaginator
    {
        return $this->withRow($this->visibility->threads($viewer))
            ->where('forum_threads.'.$column, $id)
            ->orderByDesc('forum_threads.last_activity_at')->orderByDesc('forum_threads.id')
            ->cursorPaginate($perPage)->withQueryString();
    }

    /**
     * FOR-05 "Meine Themen": every state but deleted, newest first.
     *
     * @return CursorPaginator<int, ForumThread>
     */
    public function mine(User $member, int $perPage): CursorPaginator
    {
        return $this->withRow(ForumThread::query()->where('forum_threads.user_id', $member->id))
            ->orderByDesc('forum_threads.created_at')->orderByDesc('forum_threads.id')
            ->cursorPaginate($perPage)->withQueryString();
    }

    /**
     * FOR-05 "Abonniert": subscribed threads the member may see, newest activity first.
     *
     * @return CursorPaginator<int, ForumThread>
     */
    public function subscriptions(User $member, int $perPage): CursorPaginator
    {
        return $this->withRow($this->visibility->threads($member))
            ->whereExists(fn (QueryBuilder $subscribed) => $subscribed->selectRaw('1')->from('forum_subscriptions', 'fs')
                ->whereColumn('fs.thread_id', 'forum_threads.id')->where('fs.user_id', $member->id))
            ->orderByDesc('forum_threads.last_activity_at')->orderByDesc('forum_threads.id')
            ->cursorPaginate($perPage)->withQueryString();
    }

    /**
     * @return list<string>
     */
    public static function replyCursorColumns(ForumPostSort $sort): array
    {
        return $sort === ForumPostSort::Helpful
            ? ['forum_posts.helpful_count', 'forum_posts.created_at', 'forum_posts.id']
            : ['forum_posts.created_at', 'forum_posts.id'];
    }

    /**
     * FOR-03: top-level replies with their answers. The reader also sees their own pending and rejected replies (with the reason). A top-level reply the reader may not
     * see (deleted, removed, of a hidden or blocked member) stays as a tombstone while it has an answer the reader may see (review SF-2):
     * other members' answers never vanish with it. A tombstone carries the attribute `tombstone` (ForumPostResource shows no author, no text).
     *
     * @return CursorPaginator<int, ForumPost>
     */
    public function replies(ForumThread $thread, ?User $viewer, ForumPostSort $sort, int $perPage): CursorPaginator
    {
        $visible = function (Builder $query) use ($viewer): Builder {
            return $query->where(fn (Builder $any) => $any
                ->where(function (Builder $shown) use ($viewer): void {
                    $this->visibility->posts($shown, $viewer);
                })
                ->when($viewer !== null, fn (Builder $own) => $own->orWhere(fn (Builder $mine) => $mine->whereNull('forum_posts.deleted_at')
                    ->where('forum_posts.user_id', $viewer?->id)
                    ->whereIn('forum_posts.status', [ForumPostStatus::Pending->value, ForumPostStatus::Rejected->value]))));
        };

        $query = ForumPost::withTrashed()
            ->where('forum_posts.thread_id', $thread->id)
            ->where('forum_posts.is_opening', false)
            ->whereNull('forum_posts.parent_id')
            ->where(fn (Builder $top) => $top
                ->where(fn (Builder $live) => $visible($live))
                ->orWhereExists(function (QueryBuilder $answers) use ($viewer): void {
                    $answers->selectRaw('1')->from('forum_posts', 'fa')->whereColumn('fa.parent_id', 'forum_posts.id');
                    $this->visibility->posts($answers, $viewer, 'fa');
                }));

        $query->with([
            'user.avatar',
            'visibleReplies' => fn (Relation $answers) => $visible($answers->getQuery())->with('user.avatar')
                ->orderBy('forum_posts.created_at')->orderBy('forum_posts.id')->limit(config()->integer('speedclub.forum.replies_shown')),
        ]);

        if ($sort === ForumPostSort::Helpful) {
            $query->orderByDesc('forum_posts.helpful_count');
        }

        /** @var CursorPaginator<int, ForumPost> $page */
        $page = $query->orderBy('forum_posts.created_at')->orderBy('forum_posts.id')->cursorPaginate($perPage)->withQueryString();
        $ids = array_map(fn (ForumPost $post): string => $post->id, $page->items());
        $shown = $ids === [] ? [] : array_flip($visible(ForumPost::withTrashed()->whereKey($ids))->pluck('forum_posts.id')->map(strval(...))->all());

        foreach ($page->items() as $post) {
            $post->setRelation('thread', $thread);

            if (! isset($shown[$post->id])) {
                $post->setAttribute('tombstone', true);
            }

            foreach ($post->getRelation('visibleReplies') as $answer) {
                $answer->setRelation('thread', $thread);
            }
        }

        return $page;
    }

    /**
     * What a row shows: category, author, vehicle chip, last poster, and whether the opening post has a photo.
     *
     * @param  Builder<ForumThread>  $query
     * @return Builder<ForumThread>
     */
    public function withRow(Builder $query): Builder
    {
        return $query->select('forum_threads.*')
            ->selectSub(fn (QueryBuilder $photos) => $photos->selectRaw('1')->from('media', 'fm')
                ->join('forum_posts as fop', 'fop.id', '=', 'fm.mediable_id')
                ->where('fm.mediable_type', (new ForumPost)->getMorphClass())
                ->whereColumn('fop.thread_id', 'forum_threads.id')
                ->where('fop.is_opening', true)
                ->whereNull('fm.deleted_at')
                ->limit(1), 'has_photos')
            ->with(['category', 'user.avatar', 'vehicle.make', 'vehicle.vehicleModel', 'vehicle.generation', 'vehicle.cover', 'vehicle.owner', 'lastPoster.avatar']);
    }

    /**
     * The exact tag in the thread's `tags` list (review SF-8): a LIKE on the JSON text for the quoted element, without JSON functions. MySQL
     * prints a JSON column with its characters as they are, MariaDB keeps the text as written (\u-escaped by PHP), so both spellings count.
     *
     * @param  Builder<ForumThread>  $query
     */
    public static function withTag(Builder $query, string $tag): void
    {
        $tag = ForumTags::normalise([$tag])[0] ?? '';
        $spellings = array_values(array_unique([(string) json_encode($tag), (string) json_encode($tag, JSON_UNESCAPED_UNICODE)]));

        $query->where(function (Builder $any) use ($spellings): void {
            foreach ($spellings as $spelling) {
                $any->orWhereRaw("forum_threads.tags LIKE ? ESCAPE '!'", ['%'.SearchTerms::escapeLike($spelling).'%']);
            }
        });
    }

    /**
     * @param  Builder<ForumThread>  $query
     * @return Builder<ForumThread>
     */
    private function sorted(Builder $query, ForumThreadSort $sort): Builder
    {
        return match ($sort) {
            ForumThreadSort::Active => $query->orderByDesc('forum_threads.is_pinned')->orderByDesc('forum_threads.last_activity_at')->orderByDesc('forum_threads.id'),
            ForumThreadSort::New => $query->orderByDesc('forum_threads.published_at')->orderByDesc('forum_threads.id'),
            ForumThreadSort::Unanswered => $query->where('forum_threads.replies_count', 0)->orderByDesc('forum_threads.published_at')->orderByDesc('forum_threads.id'),
            ForumThreadSort::Solved => $query->whereNotNull('forum_threads.solved_post_id')->orderByDesc('forum_threads.last_activity_at')->orderByDesc('forum_threads.id'),
        };
    }

    /**
     * @return list<int>
     */
    private function childIds(ForumCategory $category): array
    {
        return array_values(array_map(intval(...), DB::table('forum_categories')->where('parent_id', $category->id)->pluck('id')->all()));
    }
}
