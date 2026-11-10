<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\SearchOverview;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * DISC-02 before a tab is opened: the first rows of each kind, their real totals and the cursor to continue with
 * `search/vehicles` or `search/users` (same `q`).
 *
 * @property SearchOverview $resource
 */
class SearchOverviewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $overview = $this->resource;

        return [
            /** The query as it was searched, trimmed. */
            'query' => $overview->query,
            /**
             * `count` stops at 1000; `count_capped` true means there are more: show "1000+".
             *
             * @var array{count: int, count_capped: bool, items: list<FeedVehicleResource>, next_cursor: string|null}
             */
            'vehicles' => [
                'count' => $overview->vehicleCount->count,
                'count_capped' => $overview->vehicleCount->capped,
                'items' => FeedVehicleResource::collection($overview->vehicles->items()),
                'next_cursor' => $overview->vehicles->nextCursor()?->encode(),
            ],
            /**
             * `count` stops at 1000; `count_capped` true means there are more: show "1000+".
             *
             * @var array{count: int, count_capped: bool, items: list<MemberSearchResource>, next_cursor: string|null}
             */
            'members' => [
                'count' => $overview->memberCount->count,
                'count_capped' => $overview->memberCount->capped,
                'items' => MemberSearchResource::collection($overview->members->items()),
                'next_cursor' => $overview->members->nextCursor()?->encode(),
            ],
        ];
    }
}
