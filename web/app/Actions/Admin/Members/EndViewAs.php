<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Models\PersonalAccessToken;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Support\ViewAs;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The end of a view-as (m3.2-contract §3), audited `member.view_as_ended` with the staff member as actor:
 *
 * - handle(): `DELETE api/v1/view-as` from the view-as tab, the only write that token may make; it revokes itself;
 * - byStaff(): the admin ends their own view-as of a member (`members.view_as`).
 *
 * Expiry ends it as well: Sanctum refuses the token after 30 minutes and `sanctum:prune-expired` removes it.
 */
class EndViewAs
{
    public function handle(User $member, PersonalAccessToken $token): void
    {
        if (! ViewAs::isToken($token) || $token->getAttribute('tokenable_id') !== $member->id) {
            throw new AuthorizationException;
        }

        DB::transaction(function () use ($member, $token): void {
            $deleted = PersonalAccessToken::query()->whereKey($token->getKey())->delete();

            if ($deleted > 0) {
                Audit::record(AdminMemberEvent::ViewAsEnded->value, $member, after: ['access_id' => $token->getKey(), 'ended_by' => 'view_as_tab'], actor: ViewAs::staffOf($token));
            }
        });
    }

    /**
     * @throws AuthorizationException
     */
    public function byStaff(Staff $staff, User $member): int
    {
        StaffAtoms::ensure($staff, 'members.view_as');

        return DB::transaction(function () use ($staff, $member): int {
            $deleted = $member->tokens()->where('name', ViewAs::NAME_PREFIX.$staff->getKey())->delete();

            if ($deleted > 0) {
                Audit::record(AdminMemberEvent::ViewAsEnded->value, $member, after: ['sessions' => $deleted, 'ended_by' => 'staff'], actor: $staff);
            }

            return $deleted;
        });
    }
}
