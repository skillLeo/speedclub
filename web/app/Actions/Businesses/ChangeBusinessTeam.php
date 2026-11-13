<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessRole;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Models\User;
use App\Services\Garage\PublicMembers;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BIZ-03 Team (09 §8.10 `business_members`): the owner adds members as staff (they edit the profile and decide tags) and removes them;
 * staff may leave. One business per member; at most members_max besides the owner. The owner cannot be removed.
 */
class ChangeBusinessTeam
{
    public function __construct(private readonly PublicMembers $members) {}

    public function add(Business $business, User $by, string $username): BusinessMember
    {
        $member = $this->members->find($username);

        if (! $member instanceof User || ! $member->isPubliclyVisible() || $member->hasBlockWith($by)) {
            throw ValidationException::withMessages(['username' => [(string) __('parts.member_unknown')]]);
        }

        return DB::transaction(function () use ($business, $member): BusinessMember {
            Business::query()->whereKey($business->id)->lockForUpdate()->value('id');

            if (BusinessMember::query()->where('user_id', $member->id)->exists()) {
                throw ValidationException::withMessages(['username' => [(string) __('parts.member_taken')]]);
            }

            $max = config()->integer('speedclub.businesses.members_max');

            if (BusinessMember::query()->where('business_id', $business->id)->where('role', BusinessRole::Staff->value)->count() >= $max) {
                throw new ApiException(ErrorCode::LimitReached, (string) __('parts.members_limit', ['max' => $max]));
            }

            return BusinessMember::query()->create(['business_id' => $business->id, 'user_id' => $member->id, 'role' => BusinessRole::Staff]);
        });
    }

    public function remove(Business $business, BusinessMember $member): void
    {
        if ($member->role === BusinessRole::Owner || $member->business_id !== $business->id) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        $member->delete();
    }
}
