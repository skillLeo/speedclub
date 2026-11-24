<?php

namespace App\Actions\Forum;

use App\Models\ForumThread;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * FOR-03 "Abonnieren": the member hears about new replies (forum_reply). Idempotent both ways.
 */
class SubscribeForumThread
{
    public function subscribe(User $user, ForumThread $thread): bool
    {
        DB::table('forum_subscriptions')->insertOrIgnore(['thread_id' => $thread->id, 'user_id' => $user->id, 'created_at' => now()]);

        return true;
    }

    public function unsubscribe(User $user, ForumThread $thread): bool
    {
        DB::table('forum_subscriptions')->where('thread_id', $thread->id)->where('user_id', $user->id)->delete();

        return false;
    }
}
