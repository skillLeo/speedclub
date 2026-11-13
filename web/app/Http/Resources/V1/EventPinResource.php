<?php

namespace App\Http\Resources\V1;

use App\Enums\EventType;
use App\Models\Event;
use App\Services\Showcase\SampleContent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A map pin of EVT-01 Karte: always the area point (never the exact place, even of a public one, so pins of one list read alike); the
 * app clusters them and opens EVT-02 on tap.
 *
 * @property Event $resource
 */
class EventPinResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $event = $this->resource;

        return [
            'id' => $event->id,
            'slug' => $event->slug,
            'title' => $event->title,
            /** @var EventType */
            'type' => $event->type,
            'starts_at' => $event->starts_at?->toIso8601String(),
            'lat' => (float) $event->getAttribute('area_lat'),
            'lng' => (float) $event->getAttribute('area_lng'),
            'is_sample' => SampleContent::isSample($event),
        ];
    }
}
