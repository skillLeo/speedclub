<?php

namespace App\Http\Resources\V1;

use App\Enums\IllegalSubReason;
use App\Enums\ReportReason;
use App\Enums\ReportStatus;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Report;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of "Meine Meldungen" (SET-16, GET me/reports). Needs case.decision and the viewer's appeals of it loaded (ReportController).
 *
 * @property Report $resource
 */
class ReportSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $report = $this->resource;
        $case = $report->case;
        $decision = $case instanceof ModerationCase && $case->relationLoaded('decision') ? $case->getRelation('decision') : null;
        $appeal = $decision instanceof Decision && $decision->relationLoaded('appeals') ? $decision->getRelation('appeals')->first() : null;

        return [
            'id' => $report->id,
            /** @var SafetyTargetResource */
            'target' => SafetyTargetResource::of($report->target_type, $report->target_label),
            /** @var ReportReason */
            'reason' => $report->reason,
            /** @var IllegalSubReason|null Only for illegal. */
            'sub_reason' => $report->sub_reason,
            /** @var ReportStatus */
            'status' => $case instanceof ModerationCase ? ReportStatus::of($case->status) : ReportStatus::Received,
            /** @var DecisionRefResource|null Set once the case is decided. */
            'decision' => $decision instanceof Decision ? new DecisionRefResource($decision, $appeal instanceof Appeal ? $appeal : null) : null,
            /** ISO 8601. */
            'created_at' => $report->created_at->toIso8601String(),
        ];
    }
}
