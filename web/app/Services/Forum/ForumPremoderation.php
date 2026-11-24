<?php

namespace App\Services\Forum;

use App\Enums\ForumPostStatus;
use App\Models\ForumPost;
use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * 10 §7.3: new accounts (younger than speedclub.forum.premoderation_days) and accounts without a verified e-mail post into
 * pre-moderation; everybody else publishes at once (keyword rules and reports still apply).
 *
 * SEC-P5-09: pre-moderation does not end at the first approval. While the author is still inside the window, an edit of a published
 * post or thread and a new photo send the post back to review (holdsChange / backToReview), the same way the first post went.
 */
final class ForumPremoderation
{
    public function needsReview(User $author): bool
    {
        return $this->reason($author) !== null;
    }

    /**
     * 'unverified' | 'new_account' | null, as the admin queue shows it.
     */
    public function reason(User $author): ?string
    {
        if (! $author->hasVerifiedEmail()) {
            return 'unverified';
        }

        $created = $author->getAttribute('created_at');
        $days = config()->integer('speedclub.forum.premoderation_days');

        if ($created === null || CarbonImmutable::parse($created)->greaterThan(CarbonImmutable::now()->subDays($days))) {
            return 'new_account';
        }

        return null;
    }

    /**
     * Whether a change of $post by $author (its text, or a photo of an opening post) goes back to review: the post is public and its
     * author is still inside the window. A post still in review stays there; one of an established member stays published.
     */
    public function holdsChange(User $author, ForumPost $post): bool
    {
        return $post->status === ForumPostStatus::Published && $this->needsReview($author);
    }

    /**
     * Sends a published post back to the review queue (not saved). It keeps published_at: ReviewForumPost reads that it was public
     * before (an approval brings it back in its place and notifies no new reply).
     */
    public static function backToReview(ForumPost $post): ForumPost
    {
        return $post->forceFill(['status' => ForumPostStatus::Pending, 'reviewed_by' => null, 'reviewed_at' => null, 'review_reason' => null]);
    }
}
