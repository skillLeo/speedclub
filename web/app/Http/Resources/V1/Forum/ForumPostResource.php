<?php

namespace App\Http\Resources\V1\Forum;

use App\Enums\ForumPostStatus;
use App\Enums\RestrictionType;
use App\Http\Resources\V1\MemberSummaryResource;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumReads;
use App\Support\Viewer;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A forum post of FOR-03 (m5.8-contract §4): a reply with one level of answers, or a thread's opening post (Thread.solution and the
 * detail use it too). `content` is the Markdown subset as a tree the app renders natively; `body` (the source) only for its author, to
 * edit. `helpful_count` is shown in the forum only (ADR-506). A deleted top-level reply with answers comes as a tombstone (`deleted`).
 *
 * @property ForumPost $resource
 */
class ForumPostResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $post = $this->resource;
        $viewer = Viewer::from($request);
        // A deleted reply, or one the reader may not see, kept as the head of visible answers (ForumListing::replies, review SF-2).
        $deleted = $post->trashed() || $post->getAttribute('tombstone') === true;
        $author = $post->user;
        $mine = $viewer !== null && $post->user_id === $viewer->id;
        $thread = $post->relationLoaded('thread') ? $post->getRelation('thread') : null;
        $writable = $viewer !== null && ! $viewer->isDeactivated() && ! $viewer->isSuspended()
            && ! $viewer->isRestrictedFrom(RestrictionType::Publishing) && ! $viewer->isRestrictedFrom(RestrictionType::Forum);
        $replies = $post->relationLoaded('visibleReplies') ? $post->getRelation('visibleReplies') : collect();
        $created = $post->created_at;
        $edited = $post->edited_at;

        return [
            'id' => $post->id,
            'thread_id' => $post->thread_id,
            'parent_id' => $post->parent_id,
            /** published; the author also sees pending ("In Prüfung"), rejected and removed. */
            'status' => $post->status,
            'author' => ! $deleted && $author instanceof User && ForumReads::showsMember($request, $author) ? new MemberSummaryResource($author) : null,
            /** The Markdown source, only for the author (to edit); null otherwise. */
            'body' => $mine && ! $deleted ? $post->body : null,
            /**
             * The text as a tree the app renders natively (Markdown subset, ForumMarkdown). A block is a `paragraph` with `children`, or a
             * `list` (`ordered`, `start` for an ordered list, else null) whose `items` are lists of blocks (paragraphs, nested lists). An
             * inline is `text` (`text`, `bold`, `italic`), `link` (`href`, http/https only, with `children`: text spans) or `break` (a line
             * break). Nothing else occurs; no HTML.
             *
             * @var list<array{type: 'paragraph'|'list', children?: list<array{type: 'text'|'link'|'break', text?: string, bold?: bool, italic?: bool, href?: string, children?: list<array{type: 'text', text: string, bold: bool, italic: bool}>}>, ordered?: bool, start?: int|null, items?: list<list<array{type: 'paragraph'|'list', children?: list<array{type: 'text'|'link'|'break', text?: string, bold?: bool, italic?: bool, href?: string, children?: list<array{type: 'text', text: string, bold: bool, italic: bool}>}>, ordered?: bool, start?: int|null, items?: list<list<array<string, mixed>>>}>>}>
             */
            'content' => $deleted ? [] : $post->contentTree(),
            /** Why the team did not publish it: a rejected post of the reader's own; null otherwise. */
            'review_reason' => $mine && ! $deleted && $post->status === ForumPostStatus::Rejected ? $post->review_reason : null,
            /** "Hilfreich" votes (shown in the forum only). */
            'helpful_count' => $post->helpful_count,
            'viewer_voted' => ForumReads::voted($request, $post),
            'is_solution' => $thread instanceof ForumThread && $thread->solved_post_id === $post->id,
            /** A deleted reply kept as the head of its answers: no author, no text. */
            'deleted' => $deleted,
            /**
             * Members the post mentions whom the reader may see.
             *
             * @var list<MemberSummaryResource>
             */
            'mentions' => $deleted ? [] : array_map(fn (User $member): MemberSummaryResource => new MemberSummaryResource($member), ForumReads::mentions($request, $post)),
            /** @var string|null */
            'edited_at' => $edited instanceof CarbonInterface ? $edited->toIso8601String() : null,
            /** @var string|null */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
            /**
             * Answers to a top-level reply, oldest first (empty for an answer).
             *
             * @var list<ForumPostResource>
             */
            'replies' => $replies->map(fn (ForumPost $reply): self => new self($reply))->values()->all(),
            /** @var array{is_author: bool, can_edit: bool, can_delete: bool, can_vote: bool, can_report: bool} */
            'viewer' => [
                'is_author' => $mine,
                'can_edit' => $mine && ! $deleted && $writable,
                'can_delete' => $mine && ! $deleted && ! $post->is_opening,
                'can_vote' => $writable && ! $mine && ! $deleted && ! $post->is_opening && $post->status === ForumPostStatus::Published,
                'can_report' => $viewer !== null && ! $mine && ! $deleted,
            ],
        ];
    }
}
