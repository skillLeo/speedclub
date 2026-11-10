<?php

namespace App\Services\Moderation;

use App\Enums\DecisionViewer;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\User;

/**
 * Who a decision speaks to (SAFE-01, m2.6-contract §2 and Addendum): the affected member, for every action that restricted them or
 * lifted a measure (M3.2 reverse) (a
 * no_action is not theirs to read: they were never told about the report), and each member who reported the case, for any action.
 */
class DecisionAudience
{
    public function roleOf(User $user, Decision $decision): ?DecisionViewer
    {
        if ($decision->subject_id === $user->id && $decision->action->concernsMember()) {
            return DecisionViewer::Affected;
        }

        $reported = Report::query()->where('case_id', $decision->case_id)->where('reporter_id', $user->id)->exists();

        return $reported || $this->heardOfAppeal($user, $decision) ? DecisionViewer::Reporter : null;
    }

    /**
     * M3.4: the outcome of an overturned appeal (its case names the appeal) also speaks to the appellant and to the members who reported
     * the appealed decision's case, as a reporter: outcome only.
     */
    private function heardOfAppeal(User $user, Decision $decision): bool
    {
        $appealId = ModerationCase::query()->whereKey($decision->case_id)->value('appeal_id');
        $appeal = is_string($appealId) ? Appeal::query()->find($appealId) : null;

        if (! $appeal instanceof Appeal) {
            return false;
        }

        if ($appeal->appellant_id === $user->id) {
            return true;
        }

        $original = Decision::query()->whereKey($appeal->decision_id)->value('case_id');

        return is_string($original) && Report::query()->where('case_id', $original)->where('reporter_id', $user->id)->exists();
    }
}
