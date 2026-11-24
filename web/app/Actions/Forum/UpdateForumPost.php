<?php

namespace App\Actions\Forum;

use App\Enums\KeywordField;
use App\Models\ForumPost;
use App\Models\User;
use App\Services\Forum\ForumCounters;
use App\Services\Forum\ForumNotifications;
use App\Services\Forum\ForumPremoderation;
use App\Services\Forum\ForumSearchKeys;
use App\Services\Rules\ContentScreen;
use Illuminate\Support\Facades\DB;

/**
 * The author edits a post's text (keyword rules; the edit is marked). An opening post refreshes the thread's search keys.
 *
 * SEC-P5-09: an author still inside the pre-moderation window (ForumPremoderation) sends a published post back to review with the
 * edit: it leaves the public thread (the author sees it "In Prüfung") until staff approve it again. The opening post of a published
 * thread does the same; the thread stays listed with its last approved search keys, its text and photos hidden from others.
 */
class UpdateForumPost
{
    public function __construct(
        private readonly ContentScreen $screen,
        private readonly ForumNotifications $notifications,
        private readonly ForumSearchKeys $keys,
        private readonly ForumPremoderation $premoderation,
        private readonly ForumCounters $counters,
    ) {}

    public function handle(ForumPost $post, string $body): ForumPost
    {
        $body = trim(str_replace(["\r\n", "\r"], "\n", $body));
        $flags = $this->screen->screen(['body' => [KeywordField::ForumText, $body]]);

        DB::transaction(function () use ($post, $body): void {
            if ($post->body === $body) {
                return;
            }

            $author = $post->user;
            $hold = $author instanceof User && $this->premoderation->holdsChange($author, $post);
            $post->writeBody($body)->forceFill(['edited_at' => now()]);

            if ($hold) {
                ForumPremoderation::backToReview($post);
            }

            $post->save();
            // Mentions of a published post only; a held one notifies once it is approved.
            $this->notifications->edited($post);

            if ($hold && ! $post->is_opening) {
                $this->counters->thread($post->thread);
            }

            if ($post->is_opening) {
                $post->thread->forceFill(['edited_at' => now()])->save();

                if (! $hold) {
                    $this->keys->refresh($post->thread);
                }
            }
        });

        $this->screen->flagAfterCommit($flags, $post);

        return $post;
    }
}
