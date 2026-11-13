<?php

namespace App\Actions\Social;

use App\Enums\CommentStatus;
use App\Enums\KeywordField;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\User;
use App\Services\Notifications\Notifier;
use App\Services\Rules\ContentScreen;
use App\Services\Social\BuildUpdateMentions;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * A comment on a build update [build_comments] (09 §8.5): flat with one reply level, so a reply to a reply joins its parent's thread.
 * Keyword rules (block refuses with 422 content_blocked, flag files an automated report), mentions, and notifications to the update's
 * owner and, for a reply, to the author of the comment replied to.
 */
class PostComment
{
    public function __construct(
        private readonly ContentScreen $screen,
        private readonly BuildUpdateMentions $mentions,
        private readonly Notifier $notifier,
    ) {}

    public function handle(User $author, BuildUpdate $update, string $body, ?Comment $parent): Comment
    {
        $body = trim(str_replace("\r\n", "\n", $body));
        $flags = $this->screen->screen(['body' => [KeywordField::Comment, $body]]);
        $thread = $parent === null ? null : ($parent->parent_id === null ? $parent : $parent->parent);

        $comment = DB::transaction(function () use ($author, $update, $body, $thread): Comment {
            $comment = new Comment(['body' => $body]);
            $comment->forceFill([
                'build_update_id' => $update->getKey(),
                'user_id' => $author->id,
                'parent_id' => $thread?->getKey(),
                'status' => CommentStatus::Visible,
            ])->save();

            $this->mentions->afterSave($update, $author, $body, $comment);

            return $comment;
        });

        $this->screen->flagAfterCommit($flags, $comment);
        $this->notify($author, $update, $comment, $parent);

        return $comment;
    }

    private function notify(User $author, BuildUpdate $update, Comment $comment, ?Comment $parent): void
    {
        $vehicle = $update->vehicle;
        $owner = $vehicle->owner;

        try {
            if ($owner instanceof User) {
                $this->notifier->comment($owner, $author, $vehicle, $update, $comment, reply: false);
            }

            $repliedTo = $parent?->user;

            if ($repliedTo instanceof User && ! $repliedTo->is($owner) && $update->reaches($repliedTo)) {
                $this->notifier->comment($repliedTo, $author, $vehicle, $update, $comment, reply: true);
            }
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
