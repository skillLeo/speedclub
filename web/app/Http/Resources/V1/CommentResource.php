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
 * A comment of VEH-05 or, since R5-5, of the car's own thread on VEH-01 [build_comments]: flat with one reply level. Top-level
 * comments carry their visible replies, oldest first.
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
            /**
             * The thread it stands in (R5-5): "build_update" (`build_update_id` set) or "vehicle", the car's own thread (`vehicle_id` set).
             *
             * @var 'build_update'|'vehicle'
             */
            'on' => $comment->isOnVehicle() ? 'vehicle' : 'build_update',
            /** @var string|null */
            'build_update_id' => $comment->build_update_id,
            /** @var string|null */
            'vehicle_id' => $comment->vehicle_id,
            'parent_id' => $comment->parent_id,
            'body' => $comment->body,
            'author' => $author instanceof User ? new MemberSummaryResource($author) : null,
            /**
             * Members the comment mentions whom the viewer may see.
             *
             * @var list<MemberSummaryResource>
             */
            'mentions' => array_map(fn (User $member): MemberSummaryResource => new MemberSummaryResource($member), app(Mentions::class)->forItems($comment->getMorphClass(), [$comment->id], $viewer)[$comment->id] ?? []),
            /** The viewer may delete it: its author, or the owner of the car. */
            'can_delete' => $viewer !== null && ($comment->user_id === $viewer->id || ($comment->threadVehicle()?->isOwnedBy($viewer) ?? false)),
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
