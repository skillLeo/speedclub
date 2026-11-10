<?php

namespace App\Http\Resources\V1;

use App\Services\Home\FeedPage;
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
