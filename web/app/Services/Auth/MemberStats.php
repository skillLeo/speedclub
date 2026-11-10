<?php

namespace App\Services\Auth;

use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * The real numbers of FS-8. Drafts and archived vehicles are not in the garage count; private and unlisted vehicles count
 * only for their owner, since a profile lists public ones and an unlisted one is reachable by link or QR alone
 * (02_PRODUCT_SPEC §3). Followers and following count the members the lists of PROF-04 can show at all: publicly visible, so
 * active, verified and not deleted (ADR-135). A block hides rows of a list from one viewer only and leaves the count alone.
 */
final class MemberStats
{
    /**
     * @return array{vehicles: int, followers: int, following: int}
     */
    public function for(User $member, bool $asOwner): array
    {
        return [
            'vehicles' => $member->vehicles()
                ->where('status', VehicleStatus::Published)
                ->when(! $asOwner, fn ($query) => $query->where('visibility', Visibility::Public))
                ->count(),
            'followers' => $this->followers($member),
            'following' => self::visible($member->following())->count(),
        ];
    }

    public function followers(User $member): int
    {
        return self::visible($member->followers())->count();
    }

    /**
     * The members of a follow relation who count: the same rule as the lists (App\Services\Social\Connections). Deleted rows are
     * already out through SoftDeletes.
     *
     * @param  BelongsToMany<User, User>  $relation
     * @return BelongsToMany<User, User>
     */
    public static function visible(BelongsToMany $relation): BelongsToMany
    {
        // With a username, as Connections lists only those (M2.1 review #2).
        return $relation->where('users.status', UserStatus::Active)->whereNotNull('users.email_verified_at')->whereNotNull('users.username');
    }
}
