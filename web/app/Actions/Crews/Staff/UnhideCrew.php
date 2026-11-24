<?php

namespace App\Actions\Crews\Staff;

use App\Actions\Moderation\ReverseDecision;
use App\Enums\CrewAuditEvent;
use App\Enums\CrewStatus;
use App\Enums\ReportTargetType;
use App\Models\Crew;
use App\Models\Decision;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Moderation\ModerationHolds;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-80/81 "Einblenden" (C6, `moderation.decide`): a `reverse` decision on the newest removal of the crew still in force; the crew is
 * active again (ContentRestoration → CrewModeration) and the founder is told why. A crew staff deleted is restored first (RestoreCrew).
 * $facts is what the founder reads, $reason the audit reason.
 *
 * @throws AuthorizationException|DomainException when nothing hides it, or it is deleted
 */
class UnhideCrew
{
    public function __construct(private readonly ReverseDecision $reverse, private readonly ModerationHolds $holds) {}

    public function handle(Staff $staff, Crew $crew, string $facts, string $reason): Decision
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        if ($crew->trashed()) {
            throw new DomainException('The crew is deleted; restore it first.');
        }

        $removal = $this->holds->activeRemoval(ReportTargetType::Crew, $crew->id)
            ?? throw new DomainException('No decision hides this crew.');

        return DB::transaction(function () use ($staff, $crew, $removal, $facts, $reason): Decision {
            $decision = $this->reverse->handle($removal, $staff, $facts, trim($reason));
            Audit::record(CrewAuditEvent::Unhidden->value, $crew, ['status' => CrewStatus::Hidden->value], ['status' => $crew->refresh()->status->value, 'decision_id' => $decision->id], trim($reason), $staff);

            return $decision;
        });
    }
}
