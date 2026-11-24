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
 * The author edits their thread (title, text, category, tags, attachments). Keyword rules on what changed; a pending thread stays pending,
 * a published one stays published (the edit is marked). New mentions of a published thread notify.
 *
 * SEC-P5-09: an author still inside the pre-moderation window (ForumPremoderation) sends a published thread's change back to review,
 * the same way the first post went. A new title or new tags (what every list shows) take the whole thread back to pending; any other
 * change (text, category, attachments) takes its opening post back, and the thread stays listed with its text and photos hidden from
 * others until staff approve it again. The author sees it "In Prüfung".
 */
class UpdateForumThread
{
    public function __construct(
        private readonly ContentScreen $screen,
        private readonly ForumAttachments $attachments,
        private readonly ForumSearchKeys $keys,
        private readonly ForumCounters $counters,
        private readonly ForumNotifications $notifications,
        private readonly ForumPremoderation $premoderation,
    ) {}

    /**
     * @param  array{title?: string, body?: string, tags?: list<string>, category?: ForumCategory, vehicle_id?: string|null, modification_id?: string|null, product_id?: string|null}  $changes
     */
    public function handle(User $author, ForumThread $thread, array $changes): ForumThread
    {
        $title = array_key_exists('title', $changes) ? trim((string) preg_replace('/\s+/u', ' ', $changes['title'])) : null;
        $body = array_key_exists('body', $changes) ? trim(str_replace(["\r\n", "\r"], "\n", $changes['body'])) : null;
        $tags = array_key_exists('tags', $changes) ? ForumTags::normalise($changes['tags']) : null;

        $flags = $this->screen->screen(array_filter([
            'title' => $title === null ? null : [KeywordField::ForumText, $title],
            'body' => $body === null ? null : [KeywordField::ForumText, $body],
            'tags' => $tags === null ? null : [KeywordField::ForumText, implode(' ', $tags)],
        ]));

        $attachmentKeys = array_intersect(['vehicle_id', 'modification_id', 'product_id'], array_keys($changes));
        // A new vehicle without a mod named drops the old mod (it belonged to the old vehicle) instead of failing on an untouched field.
        $vehicleChanged = array_key_exists('vehicle_id', $changes) && $changes['vehicle_id'] !== $thread->vehicle_id;
        $attached = $attachmentKeys === [] ? [] : $this->attachments->resolve(
            $author,
            array_key_exists('vehicle_id', $changes) ? $changes['vehicle_id'] : $thread->vehicle_id,
            array_key_exists('modification_id', $changes) ? $changes['modification_id'] : ($vehicleChanged ? null : $thread->modification_id),
            array_key_exists('product_id', $changes) ? $changes['product_id'] : $thread->product_id,
        );

        $review = $this->premoderation->needsReview($author);

        $opening = DB::transaction(function () use ($thread, $title, $body, $tags, $changes, $attached, $review): ?ForumPost {
            /** @var ForumThread $locked */
            $locked = ForumThread::query()->whereKey($thread->id)->lockForUpdate()->firstOrFail();
            $before = $locked->category_id;

            $values = array_filter([
                'title' => $title,
                'slug' => $title === null ? null : (Str::limit(Str::slug($title), 140, '') ?: 'thema'),
                'category_id' => isset($changes['category']) ? $changes['category']->id : null,
            ], fn (mixed $value): bool => $value !== null);

            if ($tags !== null) {
                $values['tags'] = $tags === [] ? null : $tags;
            }

            // A thread the team did not publish goes back to pre-moderation with its edit (review nit): the author can fix it.
            $resubmit = $locked->status === ForumThreadStatus::Rejected;
            $locked->forceFill([...$values, ...$attached]);
            $opening = ForumPost::query()->where('thread_id', $locked->id)->where('is_opening', true)->first();
            $bodyChanged = $body !== null && $opening instanceof ForumPost && $opening->body !== $body;

            // SEC-P5-09: a published thread of an author still inside the window goes back to review with what changed.
            $held = $review && ! $resubmit && $locked->status === ForumThreadStatus::Published && $opening instanceof ForumPost
                && ($bodyChanged || $locked->isDirty());
            $wholeThread = $held && $locked->isDirty(['title', 'tags']);
            $toPending = $resubmit || $wholeThread;

            $locked->forceFill(['edited_at' => now(),
                ...($toPending ? ['status' => ForumThreadStatus::Pending, 'reviewed_by' => null, 'reviewed_at' => null] : [])])->save();

            if ($bodyChanged) {
                $opening->writeBody($body)->forceFill(['edited_at' => now()]);
            }

            if ($resubmit && $opening instanceof ForumPost) {
                $opening->forceFill(['status' => ForumPostStatus::Pending, 'reviewed_by' => null, 'reviewed_at' => null]);
            } elseif ($held) {
                ForumPremoderation::backToReview($opening);
            }

            if ($opening instanceof ForumPost && $opening->isDirty()) {
                $opening->save();
            }

            if ($bodyChanged) {
                // Mentions of a published post only; a held one notifies once it is approved.
                $this->notifications->edited($opening);
            }

            // A held opening post keeps the thread's last approved search keys until staff approve the change (ReviewForumPost refreshes).
            if (! $held || $wholeThread) {
                $this->keys->refresh($locked);
            }

            if ($before !== $locked->category_id || $wholeThread) {
                $this->counters->category($before, $locked->category_id);
            }

            $thread->setRawAttributes($locked->getAttributes(), true);

            return $opening;
        });

        if ($opening instanceof ForumPost) {
            $this->screen->flagAfterCommit($flags, $opening);
        }

        return $thread;
    }
}
