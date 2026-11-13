<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\MemberCollection;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * A tile of COL-01 (09 §7.7): always private, so its numbers are the member's own. `covers` are up to four photos of the newest items the
 * member can still see (the 2×2 mosaic); `contains` answers "is this item in here" for the save sheet when the list was asked with
 * contains_type and contains_id.
 *
 * @property MemberCollection $resource
 */
class MemberCollectionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $collection = $this->resource;
        /** @var Collection<int, Media> $covers */
        $covers = $collection->relationLoaded('covers') ? $collection->getRelation('covers') : collect();
        $created = $collection->getAttribute('created_at');
        $updated = $collection->getAttribute('updated_at');

        return [
            'id' => $collection->id,
            /** The member's name, or "Gespeichert" / "Saved" for the default collection never renamed. */
            'name' => $collection->displayName(),
            /** "Gespeichert": cannot be deleted; the save button of a build adds to it. */
            'is_default' => $collection->is_default,
            'position' => $collection->position,
            /**
             * Everything stored, also what the member cannot see at the moment (it comes back when it is visible again).
             */
            'items_count' => (int) $collection->getAttribute('items_count'),
            /**
             * Up to four photos for the mosaic, newest item first.
             *
             * @var list<MediaResource>
             */
            'covers' => $covers->map(fn (Media $photo): MediaResource => new MediaResource($photo))->values()->all(),
            /**
             * Only when asked with contains_type and contains_id: whether that item is in this collection.
             */
            'contains' => $collection->getAttribute('contains') === null ? null : (bool) $collection->getAttribute('contains'),
            /** @var string|null */
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
            /** @var string|null */
            'updated_at' => $updated instanceof CarbonInterface ? $updated->toIso8601String() : null,
        ];
    }
}
