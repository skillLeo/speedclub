<?php

namespace App\Services\Crews;

use App\Enums\CrewRole;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\User;

/**
 * The reader's role and open request or invitation for a page of crews, in three queries (contract-crews.md §2 `viewer`), and for founder
 * and admins the number of open requests and invitations of their crews.
 */
final class CrewViewerState
{
    /**
     * @param  iterable<Crew>  $crews
     */
    public function prepare(iterable $crews, ?User $viewer, bool $counts = false): void
    {
        $list = [];

        foreach ($crews as $crew) {
            $list[$crew->id] = $crew;
        }

        if ($viewer === null || $list === []) {
            return;
        }

        $ids = array_keys($list);
        $roles = CrewMember::query()->where('user_id', $viewer->id)->whereIn('crew_id', $ids)->pluck('role', 'crew_id')->all();
        $requests = CrewRequest::query()->where('user_id', $viewer->id)->whereIn('crew_id', $ids)->pluck('id', 'crew_id')->all();
        $invites = CrewInvite::query()->where('user_id', $viewer->id)->whereIn('crew_id', $ids)->pluck('id', 'crew_id')->all();
        $running = [];

        foreach ($list as $id => $crew) {
            $role = is_string($roles[$id] ?? null) ? CrewRole::from($roles[$id]) : (($roles[$id] ?? null) instanceof CrewRole ? $roles[$id] : null);
            $request = $requests[$id] ?? null;
            $invite = $invites[$id] ?? null;

            $crew->viewer = [
                'role' => $role,
                'state' => match (true) {
                    $role !== null => 'member',
                    is_string($invite) => 'invited',
                    is_string($request) => 'requested',
                    default => 'none',
                },
                'invite_id' => $role === null && is_string($invite) ? $invite : null,
                'request_id' => $role === null && is_string($request) ? $request : null,
            ];

            if ($role?->runsCrew() ?? false) {
                $running[] = $id;
            }
        }

        if (! $counts || $running === []) {
            return;
        }

        $openRequests = CrewRequest::query()->whereIn('crew_id', $running)->selectRaw('crew_id, count(*) as n')->groupBy('crew_id')->pluck('n', 'crew_id')->all();
        $openInvites = CrewInvite::query()->whereIn('crew_id', $running)->selectRaw('crew_id, count(*) as n')->groupBy('crew_id')->pluck('n', 'crew_id')->all();

        foreach ($running as $id) {
            $list[$id]->pendingRequests = (int) ($openRequests[$id] ?? 0);
            $list[$id]->openInvites = (int) ($openInvites[$id] ?? 0);
        }
    }
}
