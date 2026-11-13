<?php

namespace App\Http\Resources\V1;

use App\Enums\EventStatus;
use App\Enums\EventType;
use App\Models\Event;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An event named somewhere else (a notification row, a report target): enough for a line of text and the link to EVT-02. Never the
 * place beyond the city.
 *
 * @property Event $resource
 */
class EventRefResource extends JsonResource
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
            /** @var EventStatus */
            'status' => $event->status,
            /** ISO 8601 (UTC); show in Europe/Berlin. */
            'starts_at' => $event->starts_at?->toIso8601String(),
            'ends_at' => $event->ends_at?->toIso8601String(),
            'city' => $event->city,
            /** 09 §8.19: a sample event ("Beispiel" badge). */
            'is_sample' => $event->is_sample,
        ];
    }
}
