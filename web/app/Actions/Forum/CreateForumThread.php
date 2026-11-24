<?php

namespace App\Actions\Forum;

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Enums\KeywordField;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumAttachments;
use App\Services\Forum\ForumCounters;
use App\Services\Forum\ForumNotifications;
use App\Services\Forum\ForumPremoderation;
use App\Services\Forum\ForumSearchKeys;
use App\Services\Forum\ForumTags;
use App\Services\Rules\ContentScreen;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * FOR-04 "Thema erstellen" (10 §7, m5.8-contract §2): the thread with its opening post, in one transaction. Keyword rules on title,
 * text and tags (block: 422 content_blocked; flag: an automated report after the commit); new or unverified accounts go into
 * pre-moderation (status pending, only the author sees it); the author is subscribed. Mentions notify once the thread is public.
 */
class CreateForumThread
{
    public function __construct(
        private readonly ContentScreen $screen,
        private readonly ForumAttachments $attachments,
        private readonly ForumPremoderation $premoderation,
        private readonly ForumSearchKeys $keys,
        private readonly ForumCounters $counters,
        private readonly ForumNotifications $notifications,
    ) {}

    /**
     * @param  list<string>  $tags
     */
    public function handle(User $author, ForumCategory $category, string $title, string $body, array $tags, ?string $vehicleId, ?string $modificationId, ?string $productId): ForumThread
    {
        $title = trim((string) preg_replace('/\s+/u', ' ', $title));
        $body = trim(str_replace(["\r\n", "\r"], "\n", $body));
        $tags = ForumTags::normalise($tags);

        $flags = $this->screen->screen([
            'title' => [KeywordField::ForumText, $title],
            'body' => [KeywordField::ForumText, $body],
            'tags' => [KeywordField::ForumText, implode(' ', $tags)],
        ]);
        $attached = $this->attachments->resolve($author, $vehicleId, $modificationId, $productId);
        $pending = $this->premoderation->needsReview($author);

        [$thread, $opening] = DB::transaction(function () use ($author, $category, $title, $body, $tags, $attached, $pending): array {
            $now = now();
            $thread = new ForumThread;
            $thread->forceFill([
                'category_id' => $category->id,
                'user_id' => $author->id,
                'title' => $title,
                'slug' => Str::limit(Str::slug($title), 140, '') ?: 'thema',
                'status' => $pending ? ForumThreadStatus::Pending : ForumThreadStatus::Published,
                'tags' => $tags === [] ? null : $tags,
                ...$attached,
                'replies_count' => 0,
                'last_activity_at' => $now,
                'published_at' => $pending ? null : $now,
                'title_keys' => '',
                'is_sample' => $author->getAttribute('is_sample') === true,
            ])->save();

            $opening = new ForumPost;
            $opening->forceFill([
                'thread_id' => $thread->id,
                'user_id' => $author->id,
                'is_opening' => true,
                'status' => $pending ? ForumPostStatus::Pending : ForumPostStatus::Published,
                'published_at' => $pending ? null : $now,
                'is_sample' => $thread->is_sample,
            ])->writeBody($body)->save();
            $opening->setRelation('thread', $thread)->setRelation('user', $author);

            DB::table('forum_subscriptions')->insertOrIgnore(['thread_id' => $thread->id, 'user_id' => $author->id, 'created_at' => $now]);
            $this->keys->refresh($thread);
            $this->counters->category($category->id);

            if (! $pending) {
                $this->notifications->published($opening);
            }

            return [$thread, $opening];
        });

        $this->screen->flagAfterCommit($flags, $opening);

        return $thread;
    }
}
