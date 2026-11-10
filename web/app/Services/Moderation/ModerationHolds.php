<?php

namespace App\Services\Moderation;

use App\Enums\AppealStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionViewer;
use App\Enums\ReportTargetType;
use App\Models\BuildUpdate;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Vehicle;
use Illuminate\Database\Query\Builder;

/**
 * Whether a remove_content decision holds a vehicle private or a build update hidden (ContentRemoval). The owner may still delete it
 * or keep it private, but cannot show it again. Only the **affected member's** reversed appeal or a reverse decision (M3.2) lifts the hold (M2.6 review #7): a
 * reporter's appeal against a removal can never bring the content back. Read from the target's cases (index target_type, target_id).
 * Photos, mods and messages need no hold: the owner has no way to undo their removal.
 */
class ModerationHolds
{
    /**
     * The newest remove_content decision on a target that no reverse decision lifted yet (M3.2: ADM-12 "Einblenden", ADM-13). Unlike
     * holds(), any target type and regardless of appeals: what staff would reverse.
     */
    public function activeRemoval(ReportTargetType $type, string $id): ?Decision
    {
        return Decision::query()
            ->select('decisions.*')
            ->join('moderation_cases', 'moderation_cases.id', '=', 'decisions.case_id')
            ->where('moderation_cases.target_type', $type->value)
            ->where('moderation_cases.target_id', $id)
            ->where('decisions.action', DecisionAction::RemoveContent->value)
            ->whereNotExists(fn (Builder $query) => $query->selectRaw('1')->from('decisions as reversals')
                ->whereColumn('reversals.reverses_decision_id', 'decisions.id'))
            ->orderByDesc('decisions.decided_at')
            ->orderByDesc('decisions.id')
            ->first();
    }

    public function holds(Vehicle|BuildUpdate $target): bool
    {
        $type = $target instanceof Vehicle ? ReportTargetType::Vehicle : ReportTargetType::BuildUpdate;

        return ModerationCase::query()
            ->where('moderation_cases.target_type', $type->value)
            ->where('moderation_cases.target_id', (string) $target->getKey())
            ->join('decisions', 'decisions.case_id', '=', 'moderation_cases.id')
            ->where('decisions.action', DecisionAction::RemoveContent->value)
            // A reverse decision (M3.2) ends the hold as well.
            ->whereNotExists(fn (Builder $query) => $query->selectRaw('1')->from('decisions as reversals')
                ->whereColumn('reversals.reverses_decision_id', 'decisions.id'))
            ->whereNotExists(fn (Builder $query) => $query->selectRaw('1')->from('appeals')
                ->whereColumn('appeals.decision_id', 'decisions.id')
                ->where('appeals.role', DecisionViewer::Affected->value)
                ->where('appeals.status', AppealStatus::Reversed->value))
            ->exists();
    }
}
