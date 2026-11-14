<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessAuditEvent;
use App\Enums\BusinessRole;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Business;
use App\Models\BusinessInvite;
use App\Models\BusinessMember;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Garage\PublicMembers;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BIZ-03 Team (09 §8.10 `business_members`, "invited staff"). SEC-414-01: the owner invites a member; only the member makes themselves
 * staff by accepting (they then edit the profile and decide tags), or declines. The owner withdraws an open invitation and removes
 * staff; staff may leave. One business per member (business_members): an open invitation is no membership, so it never blocks the
 * member's own application and never confirms a portfolio tag. At most members_max staff and open invitations together besides the
 * owner. The owner cannot be removed. Every step is audited (the member as actor) and the other side hears about it in the app.
 */
class ChangeBusinessTeam
{
    public function __construct(private readonly PublicMembers $members, private readonly Notifier $notifier) {}

    public function invite(Business $business, User $by, string $username): BusinessInvite
    {
        $member = $this->members->find($username);

        if (! $member instanceof User || ! $member->isPubliclyVisible() || $member->hasBlockWith($by) || $member->hasBlockWith($business->owner)) {
            throw ValidationException::withMessages(['username' => [(string) __('parts.member_unknown')]]);
        }

        $invite = DB::transaction(function () use ($business, $by, $member): BusinessInvite {
            Business::query()->whereKey($business->id)->lockForUpdate()->value('id');

            if (BusinessMember::query()->where('user_id', $member->id)->exists()) {
                throw ValidationException::withMessages(['username' => [(string) __('parts.member_taken')]]);
            }

            if (BusinessInvite::query()->where('business_id', $business->id)->where('user_id', $member->id)->exists()) {
                throw ValidationException::withMessages(['username' => [(string) __('parts.member_invited')]]);
            }

            $max = config()->integer('speedclub.businesses.members_max');
            $taken = BusinessMember::query()->where('business_id', $business->id)->where('role', BusinessRole::Staff->value)->count()
                + BusinessInvite::query()->where('business_id', $business->id)->count();

            if ($taken >= $max) {
                throw new ApiException(ErrorCode::LimitReached, (string) __('parts.members_limit', ['max' => $max]));
            }

            $invite = new BusinessInvite;
            $invite->forceFill(['business_id' => $business->id, 'user_id' => $member->id, 'invited_by' => $by->id])->save();
            Audit::record(BusinessAuditEvent::MemberInvited->value, $business, null, ['username' => $member->username], actor: $by);

            return $invite;
        });

        $this->notifier->businessInvite($member, $business, $by, $invite->id, 'invited', false);

        return $invite;
    }

    /**
     * The invited member joins as staff. 409 business_exists when they own or work for a business meanwhile; 404 business_unavailable
     * when the business was taken down or a block came between them; 409 limit_reached when the team filled up.
     */
    public function accept(User $member, BusinessInvite $invite): Business
    {
        $business = DB::transaction(function () use ($member, $invite): Business {
            User::query()->whereKey($member->id)->lockForUpdate()->value('id');
            $locked = BusinessInvite::query()->whereKey($invite->id)->lockForUpdate()->first();
            $business = $locked instanceof BusinessInvite ? Business::query()->with('owner')->whereKey($locked->business_id)->lockForUpdate()->first() : null;

            if (! $locked instanceof BusinessInvite || ! $business instanceof Business || $business->removed_at !== null || $member->hasBlockWith($business->owner)) {
                throw new ApiException(ErrorCode::BusinessUnavailable);
            }

            if (BusinessMember::query()->where('user_id', $member->id)->exists() || Business::query()->where('owner_id', $member->id)->exists()) {
                throw new ApiException(ErrorCode::BusinessExists);
            }

            $max = config()->integer('speedclub.businesses.members_max');

            if (BusinessMember::query()->where('business_id', $business->id)->where('role', BusinessRole::Staff->value)->count() >= $max) {
                throw new ApiException(ErrorCode::LimitReached, (string) __('parts.members_limit', ['max' => $max]));
            }

            BusinessMember::query()->create(['business_id' => $business->id, 'user_id' => $member->id, 'role' => BusinessRole::Staff]);
            // One business per member: the member's other invitations are void now.
            $others = BusinessInvite::query()->where('user_id', $member->id)->pluck('id')->all();
            BusinessInvite::query()->where('user_id', $member->id)->delete();
            Audit::record(BusinessAuditEvent::InviteAccepted->value, $business, null, ['username' => $member->username], actor: $member);

            foreach ($others as $id) {
                $this->notifier->forgetBusinessInvite($member, $id);
            }

            return $business;
        });

        $this->notifier->businessInvite($business->owner, $business, $member, $invite->id, 'accepted', true);

        return $business;
    }

    public function decline(User $member, BusinessInvite $invite): void
    {
        $business = DB::transaction(function () use ($member, $invite): ?Business {
            $locked = BusinessInvite::query()->whereKey($invite->id)->lockForUpdate()->first();

            if (! $locked instanceof BusinessInvite) {
                return null;
            }

            $locked->delete();
            $business = Business::query()->with('owner')->find($locked->business_id);

            if ($business instanceof Business) {
                Audit::record(BusinessAuditEvent::InviteDeclined->value, $business, null, ['username' => $member->username], actor: $member);
            }

            return $business;
        });

        $this->notifier->forgetBusinessInvite($member, $invite->id);

        if ($business instanceof Business) {
            $this->notifier->businessInvite($business->owner, $business, $member, $invite->id, 'declined', true);
        }
    }

    /**
     * The owner takes an open invitation back; the member's "invited" row goes with it.
     */
    public function withdraw(Business $business, User $by, BusinessInvite $invite): void
    {
        if ($invite->business_id !== $business->id) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        DB::transaction(function () use ($business, $by, $invite): void {
            $deleted = BusinessInvite::query()->whereKey($invite->id)->delete();

            if ($deleted > 0) {
                Audit::record(BusinessAuditEvent::InviteWithdrawn->value, $business, null, ['username' => $invite->user->username], actor: $by);
            }
        });

        $this->notifier->forgetBusinessInvite($invite->user, $invite->id);
    }

    /**
     * The owner removes staff, or staff leave. The other side hears about it.
     */
    public function remove(Business $business, User $by, BusinessMember $member): void
    {
        if ($member->role === BusinessRole::Owner || $member->business_id !== $business->id) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        $left = $member->user_id === $by->id;
        $user = $member->user;

        DB::transaction(function () use ($business, $by, $member, $left, $user): void {
            $member->delete();
            Audit::record(($left ? BusinessAuditEvent::MemberLeft : BusinessAuditEvent::MemberRemoved)->value, $business, ['username' => $user->username], null, actor: $by);
        });

        $left
            ? $this->notifier->businessInvite($business->owner, $business, $user, $member->id, 'left', true)
            : $this->notifier->businessInvite($user, $business, $by, $member->id, 'removed', false);
    }
}
