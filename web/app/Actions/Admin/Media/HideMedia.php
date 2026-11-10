<?php

namespace App\Actions\Admin\Media;

use App\Actions\Moderation\DecideCase;
use App\Enums\DecisionAction;
use App\Enums\ModerationStatus;
use App\Models\Decision;
use App\Models\Media;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use App\Services\Moderation\Statement;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-13 "Ausblenden" (`media.hide`, recent password, keyboard H): a remove_content decision on the photo (m3.2-contract §1), on its
 * open case or a new own-initiative one: rejected, its public files withdrawn at once (ADR-123), a cover or avatar moved on; the private
 * original stays for a reversal. The owner gets the statement of reasons; the photo counts as reviewed. Audited `moderation.decided`.
 *
 * @throws AuthorizationException|DomainException when it is removed already
 */
class HideMedia
{
    public function __construct(
        private readonly DecideCase $decide,
        private readonly OwnInitiativeCases $cases,
    ) {}

    public function handle(Staff $staff, Media $photo, Statement $statement, string $reason): Decision
    {
        StaffAtoms::ensure($staff, 'media.hide');

        if ($photo->trashed() || $photo->moderation_status === ModerationStatus::Rejected) {
            throw new DomainException('The photo is removed already.');
        }

        return DB::transaction(function () use ($staff, $photo, $statement, $reason): Decision {
            $case = $this->cases->forTarget($photo, $staff);
            $decision = $this->decide->handle($case, new DecisionInput(
                action: DecisionAction::RemoveContent,
                facts: $statement->facts,
                ground: $statement->ground,
                groundDocument: $statement->groundDocument,
                groundSection: $statement->groundSection,
                decidedBy: $staff,
                reason: trim($reason),
                // ADR-243: automated only when the triage flagged the photo this staff case is about (ai_detected) or a keyword rule filed it.
                automatedDetection: CaseRecord::automatedDetection($case),
            ));

            Media::query()->whereKey($photo->id)->update(['reviewed_at' => now(), 'reviewed_by' => $staff->getKey()]);

            return $decision;
        });
    }
}
