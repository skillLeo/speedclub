<?php

namespace App\Services\Moderation;

use App\Enums\CaseOrigin;
use App\Enums\CaseStatus;
use App\Models\Appeal;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\Decision;
use App\Models\Event;
use App\Models\Media;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Report;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * The case a staff decision taken from the admin is recorded on (m3.2-contract §1). DecideCase stays the only writer of decisions, and
 * a decision always belongs to a case, so staff acting without a report open an own-initiative case (origin staff, no report rows).
 *
 * - forTarget(): an open case of the target wins: a report about the same member or vehicle is answered by the same decision, and its
 *   reporters hear the outcome. Otherwise a new own-initiative case, open under the target's key until it is decided.
 * - forReversal(): a reverse decision gets a case of its own, outside the open-target index, so a report arriving meanwhile opens its
 *   own case and is never answered by the reversal.
 *
 * Call inside the transaction that decides the case.
 */
class OwnInitiativeCases
{
    public function __construct(private readonly ReportTargets $targets) {}

    public function forTarget(User|Vehicle|Media|BuildUpdate|Modification|Message|Comment|Event $target, Staff $by): ModerationCase
    {
        $resolved = $this->targets->forStaff($target);
        $key = ModerationCase::openKey($resolved->type, $resolved->id());

        $open = ModerationCase::query()->where('open_target', $key)->lockForUpdate()->first();

        if ($open !== null) {
            return $open;
        }

        try {
            return DB::transaction(function () use ($resolved, $key, $by): ModerationCase {
                $case = new ModerationCase;
                $case->forceFill([
                    'target_type' => $resolved->type,
                    'target_id' => $resolved->id(),
                    'origin' => CaseOrigin::Staff,
                    'target_label' => $resolved->label === '' ? null : $resolved->label,
                    'open_target' => $key,
                    'subject_id' => $resolved->subjectId,
                    'status' => CaseStatus::InReview,
                    'priority' => 0,
                    'report_count' => 0,
                    'assigned_staff_id' => $by->getKey(),
                ])->save();

                return $case;
            });
        } catch (UniqueConstraintViolationException) {
            // A report opened the target's case in the same moment: decide that one.
            return ModerationCase::query()->where('open_target', $key)->lockForUpdate()->firstOrFail();
        }
    }

    /**
     * M3.4: the case of the new measure after an overturned reporter appeal against no action: the target's open case if there is one
     * (its reporters hear the outcome too), else a new own-initiative case; either names the appeal, so the appellant and the original
     * reporters are told (DecideCase::notifyAppealAudience).
     */
    public function forAppeal(User|Vehicle|Media|BuildUpdate|Modification|Message|Comment|Event $target, Staff $by, Appeal $appeal): ModerationCase
    {
        $case = $this->forTarget($target, $by);

        if ($case->appeal_id === null) {
            $case->forceFill(['appeal_id' => $appeal->id])->save();
        }

        return $case;
    }

    public function forReversal(Decision $original, Staff $by, ?Appeal $appeal = null): ModerationCase
    {
        $source = $original->case ?? ModerationCase::query()->findOrFail($original->case_id);

        $case = new ModerationCase;
        $case->forceFill([
            'target_type' => $source->target_type,
            'target_id' => $source->target_id,
            'origin' => CaseOrigin::Staff,
            'target_label' => $source->target_label ?? Report::query()->where('case_id', $source->id)->orderBy('created_at')->orderBy('id')->value('target_label'),
            'open_target' => null,
            'subject_id' => $original->subject_id,
            'status' => CaseStatus::InReview,
            'priority' => 0,
            'report_count' => 0,
            'assigned_staff_id' => $by->getKey(),
            // M3.4: an upheld appeal against this measure is recorded here (DecideAppeal).
            'appeal_id' => $appeal?->id,
        ])->save();

        return $case;
    }
}
