<?php

namespace App\Http\Resources\V1\Forum;

use App\Http\Resources\V1\MemberSummaryResource;
use App\Http\Resources\V1\VehicleRefResource;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Forum\ForumReads;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A thread row (FOR-01, FOR-02, FOR-05, search, Home "Gerade im Forum", VEH-01 "Diskussionen"): title, category and vehicle chip, last
 * activity, the reply count (shown in the forum only, ADR-506) and the "Gelöst" badge. `is_sample` asks for the "Beispiel" badge.
 *
 * @property ForumThread $resource
 */
class ForumThreadRowResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return self::row($this->resource, $request);
    }

    /**
     * @return array<string, mixed>
     */
    public static function row(ForumThread $thread, Request $request): array
    {
        $category = $thread->category;
        $author = $thread->user;
        $vehicle = $thread->relationLoaded('vehicle') ? $thread->getRelation('vehicle') : $thread->vehicle;
        $lastPoster = $thread->relationLoaded('lastPoster') ? $thread->getRelation('lastPoster') : null;
        $activity = $thread->last_activity_at;
        $photos = $thread->getAttribute('has_photos');

        // The detail loads the opening post's photos instead of the lists' sub-query.
        if ($photos === null && $thread->relationLoaded('openingPost') && ($opening = $thread->getRelation('openingPost')) instanceof ForumPost && $opening->relationLoaded('photos')) {
            $photos = $opening->getRelation('photos')->isNotEmpty();
        }

        return [
            'id' => $thread->id,
            'title' => $thread->title,
            'slug' => $thread->slug,
            /** published for everybody; the author also sees pending ("In Prüfung"), rejected, removed and merged threads on FOR-05. */
            'status' => $thread->status,
            /** @var array{id: int, slug: string, name: string, kind: string} */
            'category' => ['id' => $category->id, 'slug' => $category->slug, 'name' => $category->name(), 'kind' => $category->kind->value],
            /** Null for a deleted account, or one the reader may no longer see. */
            'author' => $author instanceof User && ForumReads::showsMember($request, $author) ? new MemberSummaryResource($author) : null,
            /** The attached build while the reader may see it. */
            'vehicle' => $vehicle instanceof Vehicle && ForumReads::showsVehicle($request, $vehicle) ? new VehicleRefResource($vehicle) : null,
            /** @var list<string> */
            'tags' => $thread->tags ?? [],
            'is_pinned' => $thread->is_pinned,
            'is_locked' => $thread->is_locked,
            'is_solved' => $thread->solved_post_id !== null,
            /** Published replies (shown in the forum only). */
            'replies_count' => $thread->replies_count,
            /** @var string|null */
            'last_activity_at' => $activity instanceof CarbonInterface ? $activity->toIso8601String() : null,
            /** Who wrote the newest reply, while the reader may see them; null before the first reply. */
            'last_poster' => $lastPoster instanceof User && ForumReads::showsMember($request, $lastPoster) ? new MemberSummaryResource($lastPoster) : null,
            'has_photos' => $photos === null ? false : (bool) $photos,
            'is_sample' => $thread->is_sample,
            /** "/forum/{id}" (FOR-03). */
            'path' => $thread->path(),
        ];
    }
}
