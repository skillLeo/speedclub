<?php

namespace App\Services\Forum;

use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Mention;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The forum part of the account's hard delete (m5.8-contract D8), inside HardDeleteAccount's transaction:
 *
 * - every post of the member goes with the account (forum_posts.user_id cascades), so their texts are gone; their mentions too;
 * - a thread the member started keeps its title and the replies of others (forum_threads.user_id is set null: "Gelöschtes Mitglied",
 *   no opening text); its tags (the member's words) are cleared and its search keys rebuilt, so no word of the erased opening text
 *   can still find it (review MF-1); a thread nobody else wrote in is deleted with them, as it would hold nothing but their title;
 * - other members' answers to the member's replies stay, as top-level replies (they would otherwise go with the parent's cascade);
 * - the member's "Hilfreich" votes and subscriptions go (cascade); counters, solutions and last posters are recounted.
 *
 * Their photos are purged before (HardDeleteAccount purges every photo the member owns).
 */
final class ForumAccountDeletion
{
    public function __construct(
        private readonly ForumCounters $counters,
        private readonly ForumSearchKeys $keys,
    ) {}

    /**
     * Before the account row is deleted. Returns what finish() recounts afterwards.
     *
     * @return array{threads: list<string>, authored: list<string>, posts: list<string>, categories: list<int>}
     */
    public function prepare(User $user): array
    {
        $postIds = ForumPost::withTrashed()->where('user_id', $user->id)->pluck('id')->map(strval(...))->all();
        $threadIds = ForumPost::withTrashed()->where('user_id', $user->id)->distinct()->pluck('thread_id')->map(strval(...))->all();
        $votedPosts = DB::table('forum_votes')->where('user_id', $user->id)->pluck('post_id')->map(strval(...))->all();

        if ($postIds !== []) {
            Mention::query()->where('mentionable_type', (new ForumPost)->getMorphClass())->whereIn('mentionable_id', $postIds)->delete();
            ForumPost::withTrashed()->whereIn('parent_id', $postIds)->where('user_id', '!=', $user->id)->update(['parent_id' => null]);
        }

        // The member's own threads nobody else wrote in: nothing of anybody else would remain.
        $alone = ForumThread::withTrashed()->where('user_id', $user->id)
            ->whereNotExists(fn ($others) => $others->selectRaw('1')->from('forum_posts', 'fo')
                ->whereColumn('fo.thread_id', 'forum_threads.id')->where('fo.user_id', '!=', $user->id))
            ->get(['id', 'category_id']);
        $categories = array_values(array_unique(array_map(intval(...), [
            ...$alone->pluck('category_id')->all(),
            ...ForumThread::withTrashed()->whereKey($threadIds)->pluck('category_id')->all(),
        ])));

        // A thread merged into one of these keeps pointing nowhere rather than blocking the delete (merged_into_id is set null).
        ForumThread::withTrashed()->whereKey($alone->modelKeys())->forceDelete();
        $remaining = array_values(array_diff($threadIds, $alone->modelKeys()));
        $authored = array_values(array_map(strval(...), ForumThread::withTrashed()->where('user_id', $user->id)->pluck('id')->all()));

        return ['threads' => $remaining, 'authored' => $authored, 'posts' => array_values(array_diff($votedPosts, $postIds)), 'categories' => $categories];
    }

    /**
     * After the account row is deleted (its posts, votes and subscriptions with it).
     *
     * @param  array{threads: list<string>, authored: list<string>, posts: list<string>, categories: list<int>}  $prepared
     */
    public function finish(array $prepared): void
    {
        // The kept threads the member started: their tags go, their search keys hold only what is left (title, category).
        ForumThread::withTrashed()->whereKey($prepared['authored'])->update(['tags' => null]);

        foreach (ForumThread::withTrashed()->whereKey(array_values(array_unique([...$prepared['threads'], ...$prepared['authored']])))->get() as $thread) {
            // A solution that went with the account leaves no "Gelöst" date behind.
            if ($thread->solved_post_id === null && $thread->solved_at !== null) {
                $thread->forceFill(['solved_at' => null])->save();
            }

            $this->counters->thread($thread);

            if (in_array($thread->id, $prepared['authored'], true)) {
                $this->keys->refresh($thread);
            }
        }

        foreach ($prepared['posts'] as $postId) {
            ForumPost::withTrashed()->whereKey($postId)->update(['helpful_count' => DB::table('forum_votes')->where('post_id', $postId)->count()]);
        }

        $this->counters->category(...$prepared['categories']);
    }
}
