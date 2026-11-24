<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * PATCH vehicles/{id}/car-of-the-day (m5.9d contract §10.3): the stored story line (trimmed, whitespace collapsed; null when removed).
 *
 * @property array{story_line: string|null} $resource
 */
class CarOfTheDayStoryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var string|null */
            'story_line' => $this->resource['story_line'],
        ];
    }
}
