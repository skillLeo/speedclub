<?php

namespace App\Actions\Social;

use App\Enums\CommentStatus;
use App\Enums\KeywordField;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\User;
use App\Models\Vehicle;
use App\Policies\VehiclePolicy;
use App\Services\Notifications\Notifier;
use App\Services\Rules\ContentScreen;
use App\Services\Social\BuildUpdateMentions;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * A comment on a build update or, since R5-5, on the car itself [build_comments] (09 §8.5): flat with one reply level, so a reply to a
 * reply joins its parent's thread. Keyword rules (block refuses with 422 content_blocked, flag files an automated report), mentions,
 * and notifications to the car's owner and, for a reply, to the author of the comment replied to. $parent must stand in the same thread
 * (the controller looks it up there).
 */
class PostComment
{
    public function __construct(
        private readonly ContentScreen $screen,
        private readonly BuildUpdateMentions $mentions,
        private readonly Notifier $notifier,
    ) {}

    public function handle(User $author, BuildUpdate|Vehicle $on, string $body, ?Comment $parent): Comment
    {
        $body = trim(str_replace("\r\n", "\n", $body));
        $flags = $this->screen->screen(['body' => [KeywordField::Comment, $body]]);
        $thread = $parent === null ? null : ($parent->parent_id === null ? $parent : $parent->parent);

        $comment = DB::transaction(function () use ($author, $on, $body, $thread): Comment {
            $comment = new Comment(['body' => $body]);
            $comment->forceFill([
                'build_update_id' => $on instanceof BuildUpdate ? $on->getKey() : null,
                'vehicle_id' => $on instanceof Vehicle ? $on->getKey() : null,
                'user_id' => $author->id,
                'parent_id' => $thread?->getKey(),
                'status' => CommentStatus::Visible,
            ])->save();

            if ($on instanceof BuildUpdate) {
                $this->mentions->afterSave($on, $author, $body, $comment);
            } else {
                $this->mentions->afterVehicleComment($on, $author, $body, $comment);
            }

            return $comment;
        });

        $this->screen->flagAfterCommit($flags, $comment);
        $this->notify($author, $on, $comment, $parent);

        return $comment;
    }

    private function notify(User $author, BuildUpdate|Vehicle $on, Comment $comment, ?Comment $parent): void
    {
        $update = $on instanceof BuildUpdate ? $on : null;
        $vehicle = $on instanceof BuildUpdate ? $on->vehicle : $on;
        $owner = $vehicle->owner;

        try {
            if ($owner instanceof User) {
                $this->notifier->comment($owner, $author, $vehicle, $update, $comment, reply: false);
            }

            $repliedTo = $parent?->user;

            if ($repliedTo instanceof User && ! $repliedTo->is($owner) && $this->reaches($on, $vehicle, $repliedTo)) {
                $this->notifier->comment($repliedTo, $author, $vehicle, $update, $comment, reply: true);
            }
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    private function reaches(BuildUpdate|Vehicle $on, Vehicle $vehicle, User $member): bool
    {
        return $on instanceof BuildUpdate ? $on->reaches($member) : (new VehiclePolicy)->view($member, $vehicle);
    }
}
