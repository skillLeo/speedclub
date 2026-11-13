<?php

namespace App\Http\Resources\V1;

use App\Services\Home\FeedPage;
use App\Services\Social\ViewerStates;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET feed. Shaped like the cursor lists (`data`, `meta.next_cursor`, `meta.per_page`), plus `meta.suggestions` on an empty first page of
 * "Folge ich".
 *
 * @property FeedPage $resource
 */
class FeedPageResource extends JsonResource
{
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $page = $this->resource;
        // M4.8: the photos of every update row in one query, and every item's build and update registered for the reader states.
        $updates = array_values(array_filter(array_map(fn ($item) => $item->update, $page->items)));
        (new EloquentCollection($updates))->loadMissing('photos');

        foreach ($page->items as $item) {
            if ($item->vehicle !== null) {
                ViewerStates::register('vehicle', (string) $item->vehicle->id);
            }

            if ($item->update !== null) {
                ViewerStates::register('build_update', (string) $item->update->getKey());
                ViewerStates::register('vehicle', (string) $item->update->getAttribute('vehicle_id'));
            }
        }

        return [
            /** @var list<FeedItemResource> */
            'data' => FeedItemResource::collection($page->items),
            'meta' => [
                /**
                 * Pass as `cursor` for the next page; null at the end.
                 */
                'next_cursor' => $page->nextCursor,
                'per_page' => $page->perPage,
                /**
                 * "Folge ich" only, and only when its first page is empty: up to 6 members to follow, with a build like one of the
                 * reader's, else active members. Null otherwise.
                 *
                 * @var list<ActiveMemberResource>|null
                 */
                'suggestions' => $page->suggestions === null ? null : ActiveMemberResource::collection($page->suggestions),
            ],
        ];
    }
}
