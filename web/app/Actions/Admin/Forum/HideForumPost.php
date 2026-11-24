<?php

namespace App\Actions\Admin\Forum;

use App\Actions\Moderation\DecideCase;
use App\Enums\DecisionAction;
use App\Enums\ForumPostStatus;
use App\Models\Decision;
use App\Models\ForumPost;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use App\Services\Moderation\Statement;
use DomainException;
use Illuminate\Support\Facades\DB;

/**
 * ADM Forum "Ausblenden" (m5.8-contract D4): a remove_content decision on the post (m3.2-contract §1), on its open case or a new
 * own-initiative one. The author gets the statement of reasons (app, push, e-mail) and may appeal; an opening post takes its thread along
 * (ForumModeration). Audited `moderation.decided` by DecideCase.
 */
class HideForumPost
{
    public function __construct(
        private readonly DecideCase $decide,
        private readonly OwnInitiativeCases $cases,
    ) {}

    public function handle(Staff $staff, ForumPost $post, Statement $statement, string $reason): Decision
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        // Only published content: a pending or rejected post was never public and is decided in pre-moderation (review nit).
        if ($post->trashed() || $post->status !== ForumPostStatus::Published) {
            throw new DomainException('Only a published post can be hidden.');
        }

        return DB::transaction(function () use ($staff, $post, $statement, $reason): Decision {
            $case = $this->cases->forTarget($post, $staff);

            return $this->decide->handle($case, new DecisionInput(
                action: DecisionAction::RemoveContent,
                facts: $statement->facts,
                ground: $statement->ground,
                groundDocument: $statement->groundDocument,
                groundSection: $statement->groundSection,
                decidedBy: $staff,
                reason: trim($reason),
                automatedDetection: CaseRecord::automatedDetection($case),
            ));
        });
    }
}
