<?php

namespace App\Actions\Crews\Staff;

use App\Enums\CrewAuditEvent;
use App\Enums\CrewStatus;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Crews\CrewModeration;
use App\Services\Notifications\Notifier;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-81 "Löschen" (C6, `moderation.decide`): only a crew that is hidden (so the founder already has the statement of reasons): status
 * removed and soft-deleted; gone for its members too, its logo and cover off the public disk at once (MF-2), its open request and
 * invitation notifications gone. Memberships, requests and invitations stay, so RestoreCrew can bring it back after
 * an appeal; the name stays taken. Audited crew.removed with the reason.
 *
 * @throws AuthorizationException|DomainException when it is not hidden
 */
class RemoveCrew
{
    public function __construct(private readonly CrewModeration $moderation, private readonly Notifier $notifier) {}

    public function handle(Staff $staff, Crew $crew, string $reason): Crew
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        if ($crew->trashed() || $crew->status !== CrewStatus::Hidden) {
            throw new DomainException('Only a hidden crew can be deleted by staff.');
        }

        $after = DB::transaction(function () use ($staff, $crew, $reason): array {
            $crew->forceFill(['status' => CrewStatus::Removed, 'removed_at' => now()])->save();
            // MF-2: the pictures leave the public disk now (rejected; the originals stay for an appeal and the case).
            $after = $this->moderation->withdrawPictures($crew);
            $crew->delete();
            Audit::record(CrewAuditEvent::Removed->value, $crew, ['status' => CrewStatus::Hidden->value], ['status' => CrewStatus::Removed->value], trim($reason), $staff);

            return $after;
        });

        foreach ($after as $step) {
            $step();
        }

        // Nit 9: open requests and invitations stay for a restore, but their notification rows lead nowhere now.
        foreach (CrewRequest::query()->where('crew_id', $crew->id)->pluck('id') as $id) {
            $this->notifier->forgetCrew((string) $id, 'request_received');
        }

        foreach (CrewInvite::query()->where('crew_id', $crew->id)->pluck('id') as $id) {
            $this->notifier->forgetCrew((string) $id, 'invited');
        }

        $this->notifier->forgetCrew($crew->id, 'request_approved');

        return $crew;
    }
}
