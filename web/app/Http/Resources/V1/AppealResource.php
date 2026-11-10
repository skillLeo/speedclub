<?php

namespace App\Http\Resources\V1;

use App\Enums\AppealStatus;
use App\Models\Appeal;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The viewer's own appeal of a decision (SAFE-01), never its text back and never anybody else's appeal.
 *
 * @property Appeal $resource
 */
class AppealResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var AppealStatus */
            'status' => $this->resource->status,
            /** ISO 8601. */
            'created_at' => $this->resource->created_at->toIso8601String(),
            /** @var string|null ISO 8601, once decided. */
            'decided_at' => $this->resource->decided_at?->toIso8601String(),
        ];
    }
}
