<?php

namespace App\Http\Resources\V1\Forum;

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\RestrictionType;
use App\Http\Resources\V1\MediaResource;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Product;
use App\Services\Ai\ForumSummaries;
use App\Support\Viewer;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;

/**
 * FOR-03 thread (m5.8-contract §4): the row of ForumThreadRowResource with the opening post's text and photos, the attachments the reader
 * may see, the solution, the merge target and what the reader may do. Report a thread with POST reports {target_type: forum_post,
 * target_id: opening_post_id}.
 *
 * @property ForumThread $resource
 */
class ForumThreadResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $thread = $this->resource;
        $viewer = Viewer::from($request);
        $mine = $thread->isAuthoredBy($viewer);
        $opening = $thread->relationLoaded('openingPost') ? $thread->getRelation('openingPost') : $thread->openingPost;
        $solution = $thread->relationLoaded('solvedPost') ? $thread->getRelation('solvedPost') : null;
        $merged = $thread->relationLoaded('mergedInto') ? $thread->getRelation('mergedInto') : null;
        $mod = $thread->relationLoaded('modification') ? $thread->getRelation('modification') : null;
        $product = $thread->relationLoaded('product') ? $thread->getRelation('product') : null;
        $gate = Gate::forUser($viewer);
        $writable = $viewer !== null && ! $viewer->isDeactivated() && ! $viewer->isSuspended()
            && ! $viewer->isRestrictedFrom(RestrictionType::Publishing) && ! $viewer->isRestrictedFrom(RestrictionType::Forum);
        $published = $thread->status === ForumThreadStatus::Published;
        $photos = $opening instanceof ForumPost && $opening->relationLoaded('photos') ? $opening->getRelation('photos') : collect();
        // SEC-P5-09: the opening post went back to review (a change by an author still in pre-moderation): others see neither its text
        // nor its photos until staff approve it; the author sees the thread "In Prüfung" like a fresh pending one.
        $inReview = $published && $opening instanceof ForumPost && $opening->status === ForumPostStatus::Pending;
        $shown = $opening instanceof ForumPost && ($mine || ! $inReview);
        $row = ForumThreadRowResource::row($thread, $request);

        if ($mine && $inReview) {
            $row['status'] = ForumThreadStatus::Pending;
        } elseif (! $shown) {
            $row['has_photos'] = false;
        }

        return [
            ...$row,
            /** The opening post: report the thread with it. Null when its author's account is gone. */
            'opening_post_id' => $opening instanceof ForumPost ? $opening->id : null,
            /** The Markdown source of the opening post, only for the author (to edit). */
            'body' => $mine && $opening instanceof ForumPost ? $opening->body : null,
            /**
             * The opening post as a tree the app renders natively (Markdown subset, ForumMarkdown). A block is a `paragraph` with `children`, or a
             * `list` (`ordered`, `start` for an ordered list, else null) whose `items` are lists of blocks (paragraphs, nested lists). An
             * inline is `text` (`text`, `bold`, `italic`), `link` (`href`, http/https only, with `children`: text spans) or `break` (a line
             * break). Nothing else occurs; no HTML.
             *
             * @var list<array{type: 'paragraph'|'list', children?: list<array{type: 'text'|'link'|'break', text?: string, bold?: bool, italic?: bool, href?: string, children?: list<array{type: 'text', text: string, bold: bool, italic: bool}>}>, ordered?: bool, start?: int|null, items?: list<list<array{type: 'paragraph'|'list', children?: list<array{type: 'text'|'link'|'break', text?: string, bold?: bool, italic?: bool, href?: string, children?: list<array{type: 'text', text: string, bold: bool, italic: bool}>}>, ordered?: bool, start?: int|null, items?: list<list<array<string, mixed>>>}>>}>
             */
            'content' => $shown ? $opening->contentTree() : [],
            /** The opening post's author deleted their account: the title stays, the text is gone (m5.8-contract D8). */
            'opening_deleted' => ! $opening instanceof ForumPost,
            /**
             * Up to 6 photos, in their order (finished ones; the author also sees those still processing).
             *
             * @var list<MediaResource>
             */
            'photos' => $photos->filter(fn (Media $photo): bool => $mine || ($shown && $photo->status === MediaStatus::Ready && $photo->moderation_status !== ModerationStatus::Rejected))
                ->values()->map(fn (Media $photo): MediaResource => new MediaResource($photo))->all(),
            /** @var array{id: string, title: string, vehicle_id: string}|null The attached mod while the reader may see it. */
            'modification' => $mod instanceof Modification && $gate->allows('view', $mod) ? ['id' => $mod->id, 'title' => (string) $mod->getAttribute('title'), 'vehicle_id' => $mod->vehicle_id] : null,
            /** @var array{id: string, name: string, full_name: string}|null The attached parts catalogue product. */
            'product' => $product instanceof Product ? ['id' => $product->id, 'name' => $product->name, 'full_name' => $product->fullName()] : null,
            /** The reply marked "Gelöst", while the reader may see it. */
            'solution' => $solution instanceof ForumPost && $solution->status === ForumPostStatus::Published && ! $solution->trashed() && $gate->allows('view', $solution)
                ? new ForumPostResource($solution->setRelation('thread', $thread))
                : null,
            /** Status merged: the thread its replies moved to; the app opens it instead. */
            'merged_into' => $merged instanceof ForumThread ? new ForumThreadRefResource($merged) : null,
            /** Why staff did not publish it (rejected; the author only). */
            'review_reason' => $mine && $thread->status === ForumThreadStatus::Rejected ? $thread->review_reason : null,
            /** @var string|null */
            'published_at' => $thread->published_at instanceof CarbonInterface ? $thread->published_at->toIso8601String() : null,
            /** @var string|null */
            'edited_at' => $thread->edited_at instanceof CarbonInterface ? $thread->edited_at->toIso8601String() : null,
            /** @var string|null */
            'created_at' => $thread->created_at instanceof CarbonInterface ? $thread->created_at->toIso8601String() : null,
            /** Opens FOR-03 in the member web (share sheet). */
            'share_url' => url('/app'.$thread->path()),
            /**
             * M5.9 (ai.forum_summary): three short lines on a published thread with more than 20 replies, labelled "KI-Zusammenfassung";
             * null otherwise, without a provider key, and for a reader with a block on an author whose posts went into it.
             *
             * @var array{label: string, lines: list<string>, based_on_replies: int, generated_at: string}|null
             */
            'ai_summary' => ($summary = app(ForumSummaries::class)->forReader($thread, $viewer)) === null ? null : ['label' => (string) __('ai.label.summary'), ...$summary],
            /** @var array{is_author: bool, subscribed: bool, can_reply: bool, can_edit: bool, can_delete: bool, can_mark_solution: bool, can_report: bool} */
            'viewer' => [
                'is_author' => $mine,
                'subscribed' => $viewer !== null && $thread->subscribers()->whereKey($viewer->id)->exists(),
                'can_reply' => $writable && $published && ! $thread->is_locked,
                'can_edit' => $mine && $writable && ! in_array($thread->status, [ForumThreadStatus::Removed, ForumThreadStatus::Merged], true),
                'can_delete' => $mine && $viewer !== null && ! $viewer->isDeactivated(),
                'can_mark_solution' => $mine && $published,
                'can_report' => $viewer !== null && ! $mine && $opening instanceof ForumPost,
            ],
        ];
    }
}
