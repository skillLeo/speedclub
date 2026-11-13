<?php

namespace App\Http\Resources\V1;

use App\Models\Comment;
use App\Models\User;
use App\Services\Social\Mentions;
use App\Support\Viewer;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A comment of VEH-05 [build_comments]: flat with one reply level. Top-level comments carry their visible replies, oldest first.
 *
 * @property Comment $resource
 */
class CommentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $comment = $this->resource;
        $viewer = Viewer::from($request);
        $author = $comment->user;
        $created = $comment->getAttribute('created_at');
        $replies = $comment->relationLoaded('visibleReplies') ? $comment->getRelation('visibleReplies') : collect();

        return [
            'id' => $comment->id,
            'build_update_id' => $comment->build_update_id,
            'parent_id' => $comment->parent_id,
            'body' => $comment->body,
            'author' => $author instanceof User ? new MemberSummaryResource($author) : null,
            /**
             * Members the comment mentions whom the viewer may see.
             *
             * @var list<MemberSummaryResource>
             */
            'mentions' => array_map(fn (User $member): MemberSummaryResource => new MemberSummaryResource($member), app(Mentions::class)->forItems($comment->getMorphClass(), [$comment->id], $viewer)[$comment->id] ?? []),
            /** The viewer may delete it: its author, or the owner of the update. */
            'can_delete' => $viewer !== null && ($comment->user_id === $viewer->id || $comment->buildUpdate->vehicle->isOwnedBy($viewer)),
            /** @var string|null */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
            /**
             * Replies, oldest first (top-level comments only; a reply's list is empty).
             *
             * @var list<CommentResource>
             */
            'replies' => $replies->map(fn (Comment $reply): self => new self($reply))->values()->all(),
        ];
    }
}
