<?php

namespace App\Http\Resources\V1;

use App\Enums\AppealStatus;
use App\Enums\DecisionAction;
use App\Models\Appeal;
use App\Models\Decision;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of "Entscheidungen zu deinen Inhalten" (SET-16, GET me/decisions): a decision that restricted the viewer. Needs the first
 * report (for the target label) and the viewer's appeals loaded (DecisionController).
 *
 * @property Decision $resource
 */
class DecisionSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $decision = $this->resource;
        $appeal = $decision->relationLoaded('appeals') ? $decision->getRelation('appeals')->first() : null;
        $restriction = $decision->restrictionType();

        return [
            'id' => $decision->id,
            /** @var SafetyTargetResource */
            'target' => SafetyTargetResource::of($decision->targetType(), DecisionResource::labelOf($decision)),
            /** @var DecisionAction */
            'action' => $decision->action,
            /** @var array{type: 'messaging'|'publishing'|'suspension', until: string|null}|null For restrict and suspend. */
            'restriction' => $restriction === null ? null : ['type' => $restriction->value, 'until' => $decision->restrictionUntil()?->toIso8601String()],
            /** ISO 8601. */
            'decided_at' => $decision->decided_at->toIso8601String(),
            /** @var AppealStatus|null */
            'appeal_status' => $appeal instanceof Appeal ? $appeal->status : null,
        ];
    }
}
