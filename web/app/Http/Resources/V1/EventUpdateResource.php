<?php

namespace App\Http\Resources\V1;

use App\Models\EventUpdate;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An organiser update (EVT-02 "Updates", EVT-06), newest first.
 *
 * @property EventUpdate $resource
 */
class EventUpdateResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            'body' => $this->resource->body,
            'created_at' => $this->resource->created_at?->toIso8601String(),
        ];
    }
}
