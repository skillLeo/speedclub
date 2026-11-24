<?php

namespace App\Actions\Forum;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\ForumPost;
use App\Models\User;
use App\Services\Progress\XpHooks;
use Illuminate\Support\Facades\DB;

/**
 * "Hilfreich" (10 §7.2, ADR-506): one per member and reply, never on one's own (422 own_content). The post row is locked first, so two
 * votes at the same moment queue and the recount after each sees the other (review SF-1). Who voted is never shown. A new vote earns
 * the reply's author the "Hilfreich" XP by its fixed rules (XpHooks::helpfulReceived, once per voter and reply, SEC-P5-14).
 */
class VoteForumPost
{
    public function __construct(private readonly XpHooks $xp) {}

    public function vote(User $user, ForumPost $post): ForumPost
    {
        if ($post->user_id === $user->id) {
            throw new ApiException(ErrorCode::OwnContent);
        }

        DB::transaction(function () use ($user, $post): void {
            ForumPost::withTrashed()->whereKey($post->id)->lockForUpdate()->value('id');
            $added = DB::table('forum_votes')->insertOrIgnore(['post_id' => $post->id, 'user_id' => $user->id, 'created_at' => now()]);
            $this->recount($post);

            if ($added > 0) {
                $this->xp->helpfulReceived($post, $user);
            }
        });

        return $post;
    }

    public function unvote(User $user, ForumPost $post): ForumPost
    {
        DB::transaction(function () use ($user, $post): void {
            ForumPost::withTrashed()->whereKey($post->id)->lockForUpdate()->value('id');
            DB::table('forum_votes')->where('post_id', $post->id)->where('user_id', $user->id)->delete();
            $this->recount($post);
        });

        return $post;
    }

    private function recount(ForumPost $post): void
    {
        $count = DB::table('forum_votes')->where('post_id', $post->id)->count();
        ForumPost::withTrashed()->whereKey($post->id)->toBase()->update(['helpful_count' => $count]);
        $post->forceFill(['helpful_count' => $count])->syncOriginalAttribute('helpful_count');
    }
}
