<?php

namespace App\Http\Resources\V1;

use App\Enums\FeedItemType;
use App\Services\Home\FeedItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item of GET feed: a vehicle card (type "vehicle", `vehicle` set, `update` null) or an update row (type "update", `update` set,
 * `vehicle` null).
 *
 * @property FeedItem $resource
 */
class FeedItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $item = $this->resource;

        return [
            'type' => $item->type,
            /** Stable over pages and reloads, for list keys: "vehicle:01k…", "update:01k…". */
            'key' => $item->key(),
            'vehicle' => $item->type === FeedItemType::Vehicle && $item->vehicle !== null ? new FeedVehicleResource($item->vehicle) : null,
            'update' => $item->type === FeedItemType::Update && $item->update !== null ? new BuildUpdateRowResource($item->update) : null,
        ];
    }
}
