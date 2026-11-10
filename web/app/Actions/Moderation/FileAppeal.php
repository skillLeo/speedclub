<?php

namespace App\Actions\Moderation;

use App\Enums\AppealStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionViewer;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Support\Moderation\AppealDeadline;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * An internal complaint (Art. 20 DSA): the affected member, or a member who reported the case (Art. 20(1), also against no_action),
 * within six months of the notification (AppealDeadline: §§ 187, 188 BGB, Europe/Berlin): later is 422 appeal_period_over. One appeal
 * per person and decision: a second, also after the first was decided, is 409 appeal_exists (unique decision_id + appellant_id).
 * Audited as a member event without the text; staff decide it in Phase 3 (ADM-24), a different person than the decider.
 */
class FileAppeal
{
    public function handle(User $member, Decision $decision, DecisionViewer $role, string $text): Appeal
    {
        // M3.2: a reversal lifted a measure; there is nothing to appeal.
        if ($decision->action === DecisionAction::Reverse) {
            throw new ApiException(ErrorCode::DecisionNotAppealable);
        }

        if ($decision->notified_at === null || ! AppealDeadline::isOpen($decision->notified_at)) {
            throw new ApiException(ErrorCode::AppealPeriodOver);
        }

        try {
            return DB::transaction(function () use ($member, $decision, $role, $text): Appeal {
                if (Appeal::query()->where('decision_id', $decision->id)->where('appellant_id', $member->id)->lockForUpdate()->exists()) {
                    throw new ApiException(ErrorCode::AppealExists);
                }

                $appeal = new Appeal;
                $appeal->forceFill([
                    'decision_id' => $decision->id,
                    'appellant_id' => $member->id,
                    'role' => $role,
                    'text' => trim($text),
                    'status' => AppealStatus::Open,
                ])->save();

                Audit::record('moderation.appeal_filed', $appeal, null, ['decision_id' => $decision->id, 'role' => $role->value], actor: $member);

                return $appeal;
            });
        } catch (UniqueConstraintViolationException) {
            throw new ApiException(ErrorCode::AppealExists);
        }
    }
}
