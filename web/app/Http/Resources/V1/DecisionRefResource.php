<?php

namespace App\Http\Resources\V1;

use App\Enums\AppealStatus;
use App\Enums\DecisionOutcome;
use App\Models\Appeal;
use App\Models\Decision;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The decision on a case the viewer reported, in a SET-16 row: the outcome only (M2.6 review #2: no_action, remove_content or measures,
 * never which measure), enough to show the pill and open SAFE-01.
 *
 * @property Decision $resource
 */
class DecisionRefResource extends JsonResource
{
    public function __construct(Decision $resource, private readonly ?Appeal $appeal = null)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            /** @var DecisionOutcome */
            'outcome' => $this->resource->outcome(),
            /** ISO 8601. */
            'decided_at' => $this->resource->decided_at->toIso8601String(),
            /** @var AppealStatus|null The viewer's own appeal, if they filed one. */
            'appeal_status' => $this->appeal?->status,
        ];
    }
}
