<?php

namespace App\Http\Resources\V1;

use App\Enums\CollectionItemType;
use App\Models\BuildUpdate;
use App\Models\Business;
use App\Models\Event;
use App\Models\MemberCollectionItem;
use App\Models\Modification;
use App\Models\Vehicle;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A tile of COL-02: the saved build (the feed card), mod, build update or event (EventCard), with when it was added. Only items the
 * member can see now are listed; exactly one of vehicle, modification, build_update and event is set.
 *
 * @property MemberCollectionItem $resource
 */
class MemberCollectionItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $item = $this->resource;
        $target = $item->relationLoaded('target') ? $item->getRelation('target') : null;
        $added = $item->getAttribute('created_at');

        return [
            'type' => $item->item_type,
            'id' => $item->item_id,
            'position' => $item->position,
            /** @var string|null */
            'added_at' => $added instanceof CarbonInterface ? $added->toIso8601String() : null,
            'vehicle' => $item->item_type === CollectionItemType::Vehicle && $target instanceof Vehicle ? new FeedVehicleResource($target) : null,
            /**
             * The mod with the build it belongs to.
             *
             * @var array{id: string, title: string, category: string|null, vehicle: VehicleRefResource}|null
             */
            'modification' => $item->item_type === CollectionItemType::Modification && $target instanceof Modification ? [
                'id' => (string) $target->getKey(),
                'title' => (string) $target->getAttribute('title'),
                'category' => $target->category->getAttribute('key'),
                'vehicle' => new VehicleRefResource($target->vehicle),
            ] : null,
            /** The update with the build it belongs to (`vehicle`: slug, full_title, cover, is_sample) for the tile's caption and link. */
            'build_update' => $item->item_type === CollectionItemType::BuildUpdate && $target instanceof BuildUpdate ? new CollectionBuildUpdateResource($target) : null,
            /** M4.12: a saved event, as the EventCard of EVT-01 (never the exact place of an after_rsvp event). */
            'event' => $item->item_type === CollectionItemType::Event && $target instanceof Event ? new EventCardResource($target) : null,
            /** M4.14: a saved business, as the BusinessCard. */
            'business' => $item->item_type === CollectionItemType::Business && $target instanceof Business ? new BusinessCardResource($target) : null,
        ];
    }
}
