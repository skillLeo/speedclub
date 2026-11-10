<?php

namespace App\Services\Garage;

use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * Who a username on a public route stands for. An old name counts for 14 days after the change (02_PRODUCT_SPEC §3.1), and
 * nobody the viewer may not see exists: unverified, suspended, deactivated, across a block (UserPolicy).
 */
class PublicMembers
{
    public function visibleTo(?User $viewer, string $username): ?User
    {
        $member = $this->find($username);

        return $member !== null && Gate::forUser($viewer)->allows('view', $member) ? $member : null;
    }

    /**
     * Whatever the state: unfollowing someone who has since been suspended must still work.
     */
    public function find(string $username): ?User
    {
        $normalized = mb_strtolower(trim($username));
        $window = now()->subDays(config()->integer('speedclub.usernames.old_username_redirect_days'));

        return User::query()->where('username', $normalized)->first()
            ?? User::query()->where('previous_username', $normalized)->where('username_changed_at', '>', $window)->first();
    }
}
