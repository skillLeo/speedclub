<?php

namespace App\Services\Crews;

use App\Enums\CrewAuditEvent;
use App\Enums\CrewEndReason;
use App\Enums\CrewRole;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\User;
use App\Services\Audit\Audit;
use Illuminate\Support\Facades\DB;

/**
 * R4DQ-21: repairs crews that lost members outside the Actions (accounts hard-deleted before C8 reached every delete path: the unverified
 * account delete, the showcase purge, test cleanups). Idempotent, run by the migration 2027_01_13_100000 and safe to run again:
 *
 * 1. a deleted account that still holds memberships is closed for the crews as DeleteAccount does (C8: hand-over, memberships go);
 * 2. a live crew without a founder passes to its oldest admin, else its oldest member (crew.founder_transferred, reason `repair`);
 * 3. a live crew without any member is ended like a crew whose last member left (soft delete, name freed, open rows go; crew.deleted,
 *    reason `repair`);
 * 4. every live crew's members_count is counted again.
 *
 * The system is the actor of the audit rows (no staff member, no member decided this).
 */
final class CrewRepair
{
    public const REASON = 'repair';

    public function __construct(
        private readonly CrewMemberships $memberships,
        private readonly CrewAccountDeletion $accountDeletion,
    ) {}

    /**
     * @return array{closed_accounts: int, founders: int, ended: int, recounted: int}
     */
    public function run(): array
    {
        $result = ['closed_accounts' => 0, 'founders' => 0, 'ended' => 0, 'recounted' => 0];

        $gone = User::onlyTrashed()->whereIn('id', CrewMember::query()->select('user_id'))->get();

        foreach ($gone as $user) {
            DB::transaction(fn () => $this->accountDeletion->accountClosed($user));
            $result['closed_accounts']++;
        }

        foreach (Crew::query()->orderBy('id')->pluck('id') as $crewId) {
            DB::transaction(function () use ($crewId, &$result): void {
                $crew = Crew::query()->whereKey($crewId)->lockForUpdate()->first();

                if (! $crew instanceof Crew) {
                    return;
                }

                if (! CrewMember::query()->where('crew_id', $crew->id)->exists()) {
                    $this->end($crew);
                    $result['ended']++;

                    return;
                }

                if (! CrewMember::query()->where('crew_id', $crew->id)->where('role', CrewRole::Founder->value)->exists()) {
                    $successor = $this->memberships->successor($crew, null);

                    if ($successor === null) {
                        // Only closing accounts are left: nobody can run the crew.
                        $this->end($crew);
                        $result['ended']++;

                        return;
                    }

                    $this->memberships->setRole($successor, CrewRole::Founder);
                    Audit::record(CrewAuditEvent::FounderTransferred->value, $crew, null, ['username' => $successor->user->username, 'reason' => self::REASON], self::REASON);
                    $result['founders']++;
                }

                $before = $crew->members_count;
                $this->memberships->recount($crew);

                if ($crew->members_count !== $before) {
                    $result['recounted']++;
                }
            });
        }

        return $result;
    }

    private function end(Crew $crew): void
    {
        CrewRequest::query()->where('crew_id', $crew->id)->delete();
        CrewInvite::query()->where('crew_id', $crew->id)->delete();
        $before = ['name' => $crew->name, 'members_count' => $crew->members_count];
        $crew->forceFill(['name_key' => null, 'members_count' => 0, 'ended_reason' => CrewEndReason::NoMembers])->save();
        $crew->delete();
        Audit::record(CrewAuditEvent::Deleted->value, $crew, $before, ['reason' => self::REASON], self::REASON);
    }
}
