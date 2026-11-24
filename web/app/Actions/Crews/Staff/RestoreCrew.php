<?php

namespace App\Actions\Crews\Staff;

use App\Enums\CrewAuditEvent;
use App\Enums\CrewStatus;
use App\Models\Crew;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-81 "Wiederherstellen" (C6, `moderation.decide`): a crew staff deleted comes back as hidden (its members see it again; UnhideCrew
 * makes it public and draws logo and cover again from their originals: a hidden crew serves no pictures, SF-11). Audited crew.restored with the reason.
 *
 * @throws AuthorizationException|DomainException when it was not deleted by staff
 */
class RestoreCrew
{
    public function handle(Staff $staff, Crew $crew, string $reason): Crew
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        if (! $crew->trashed() || $crew->status !== CrewStatus::Removed) {
            throw new DomainException('Only a crew deleted by staff can be restored.');
        }

        DB::transaction(function () use ($staff, $crew, $reason): void {
            $crew->restore();
            $crew->forceFill(['status' => CrewStatus::Hidden, 'removed_at' => null])->save();
            Audit::record(CrewAuditEvent::Restored->value, $crew, ['status' => CrewStatus::Removed->value], ['status' => CrewStatus::Hidden->value], trim($reason), $staff);
        });

        return $crew;
    }
}
