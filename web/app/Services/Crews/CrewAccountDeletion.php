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
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * C8 (contract-crews.md): when a member closes their account (DeleteAccount, inside its transaction) and again before the hard delete
 * (HardDeleteAccount; a second run finds nothing). Their open requests and invitations go, and invitations they sent lose their sender;
 * every crew they founded passes to the oldest admin, else the oldest member, else it is deleted; then their memberships go. Every logo
 * and cover they uploaded passes to its crew's founder (SF-4), so withdrawing the account's media does not blank the crew. Audited (crew.founder_transferred /
 * crew.deleted, reason account_closed) with the closing member, or the system in the hard delete, as actor.
 */
final class CrewAccountDeletion
{
    public function __construct(private readonly CrewMemberships $memberships, private readonly Notifier $notifier) {}

    public function accountClosed(User $user): void
    {
        $requests = CrewRequest::query()->where('user_id', $user->id)->pluck('id')->all();
        CrewRequest::query()->whereIn('id', $requests)->delete();
        CrewInvite::query()->where('user_id', $user->id)->delete();

        // The admins' "möchte in die Crew" rows of the member's requests go; the member's own rows go with the account.
        foreach ($requests as $request) {
            DB::afterCommit(fn () => $this->notifier->forgetCrew((string) $request, 'request_received'));
        }

        $founded = CrewMember::query()->where('user_id', $user->id)->where('role', CrewRole::Founder->value)->pluck('crew_id')->all();

        foreach ($founded as $crewId) {
            $crew = Crew::withTrashed()->whereKey($crewId)->lockForUpdate()->first();

            if (! $crew instanceof Crew) {
                continue;
            }

            $successor = $this->memberships->successor($crew, $user);

            if ($successor === null) {
                $this->deleteCrew($crew);

                continue;
            }

            // Nit 7: the successor may end up founding more than founded_max crews this way; the limit guards founding and hand-overs
            // by choice, never a crew that would otherwise be lost.
            $this->memberships->setRole($successor, CrewRole::Founder);
            Audit::record(CrewAuditEvent::FounderTransferred->value, $crew, null, ['username' => $successor->user->username, 'reason' => 'account_closed'], actor: null);
        }

        // SF-4: every crew picture the member uploaded (as founder or admin) passes to its crew's founder now.
        $this->memberships->reownMedia($user);

        $crews = CrewMember::query()->where('user_id', $user->id)->pluck('crew_id')->all();
        CrewMember::query()->where('user_id', $user->id)->delete();

        foreach (Crew::withTrashed()->whereIn('id', $crews)->get() as $crew) {
            $this->memberships->recount($crew);
        }
    }

    private function deleteCrew(Crew $crew): void
    {
        CrewRequest::query()->where('crew_id', $crew->id)->delete();
        CrewInvite::query()->where('crew_id', $crew->id)->delete();

        if (! $crew->trashed()) {
            $crew->forceFill(['name_key' => null, 'ended_reason' => CrewEndReason::NoMembers])->save();
            $crew->delete();
        }

        Audit::record(CrewAuditEvent::Deleted->value, $crew, ['name' => $crew->name], ['reason' => 'account_closed'], actor: null);
    }
}
