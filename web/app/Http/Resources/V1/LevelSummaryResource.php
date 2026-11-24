<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.9d (contract §10.5): the quiet level next to a member's name ("Lvl 4 · Parts Hunter").
 *
 * @property array{level: int, title: string} $resource
 */
class LevelSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** 1–10. */
            'level' => (int) $this->resource['level'],
            /** The level's title in the request's language. */
            'title' => (string) $this->resource['title'],
        ];
    }
}
