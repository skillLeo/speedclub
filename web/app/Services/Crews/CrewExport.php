<?php

namespace App\Services\Crews;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * crews.json of the data export (contract-crews.md §7): the member's crews with role and join date, their open join requests, the
 * invitations they received and the ones they sent (crew and the invited member's username). Deleted crews are left out.
 */
final class CrewExport
{
    /**
     * @return array{memberships: list<array<string, mixed>>, requests: list<array<string, mixed>>, invites_received: list<array<string, mixed>>, invites_sent: list<array<string, mixed>>}
     */
    public function forMember(User $user): array
    {
        $id = $user->id;
        $rows = fn ($query): array => array_values($query->get()->map(fn (object $row): array => (array) $row)->all());

        return [
            'memberships' => $rows(DB::table('crew_members')->join('crews', 'crews.id', '=', 'crew_members.crew_id')
                ->where('crew_members.user_id', $id)->whereNull('crews.deleted_at')->orderBy('crew_members.joined_at')
                ->select(['crews.name as crew', DB::raw("concat('/crews/', crews.slug) as url"), 'crew_members.role', 'crew_members.joined_at'])),
            'requests' => $rows(DB::table('crew_requests')->join('crews', 'crews.id', '=', 'crew_requests.crew_id')
                ->where('crew_requests.user_id', $id)->whereNull('crews.deleted_at')->orderBy('crew_requests.created_at')
                ->select(['crews.name as crew', 'crew_requests.created_at as requested_at'])),
            'invites_received' => $rows(DB::table('crew_invites')->join('crews', 'crews.id', '=', 'crew_invites.crew_id')
                ->where('crew_invites.user_id', $id)->whereNull('crews.deleted_at')->orderBy('crew_invites.created_at')
                ->select(['crews.name as crew', 'crew_invites.created_at as invited_at'])),
            'invites_sent' => $rows(DB::table('crew_invites')->join('crews', 'crews.id', '=', 'crew_invites.crew_id')
                ->join('users', 'users.id', '=', 'crew_invites.user_id')
                ->where('crew_invites.invited_by', $id)->whereNull('crews.deleted_at')->orderBy('crew_invites.created_at')
                ->select(['crews.name as crew', 'users.username', 'crew_invites.created_at as invited_at'])),
        ];
    }
}
