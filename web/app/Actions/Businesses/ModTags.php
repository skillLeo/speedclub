<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessStatus;
use App\Enums\ErrorCode;
use App\Enums\ModTagInitiator;
use App\Enums\ModTagStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Exceptions\ApiException;
use App\Models\Business;
use App\Models\ModBusinessTag;
use App\Models\Modification;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * "Eingebaut von" with double confirmation (09 §8.10, ADR-414). Either side asks first: the build's owner names the business on a mod
 * (request) or the business proposes a mod of a public build it worked on (propose). The other side confirms (accepted) or declines;
 * only an accepted tag sets modifications.installed_by_business_id, which the business page's portfolio and the mod's public face read.
 * Either side removes a tag at any time (the row goes). Both sides hear about it in the app (Notifier::businessTag). A business must be
 * verified to tag or be tagged (409 business_not_verified). A member of the business's team tagging their own mod confirms both sides.
 */
class ModTags
{
    public function __construct(private readonly Notifier $notifier) {}

    /**
     * The owner names $business on $mod. Replaces another business's tag of the mod; confirms a pending proposal of the same business.
     */
    public function request(User $owner, Modification $mod, Business $business): ModBusinessTag
    {
        if ($business->status !== BusinessStatus::Verified || $business->removed_at !== null) {
            throw new ApiException(ErrorCode::BusinessNotVerified);
        }

        $ownTeam = $business->roleOf($owner) !== null;
        $notify = null;

        $tag = DB::transaction(function () use ($owner, $mod, $business, $ownTeam, &$notify): ModBusinessTag {
            Modification::query()->whereKey($mod->id)->lockForUpdate()->value('id');
            $tag = ModBusinessTag::query()->where('mod_id', $mod->id)->lockForUpdate()->first();

            if ($tag instanceof ModBusinessTag && $tag->business_id === $business->id) {
                if ($tag->status === ModTagStatus::Pending && $tag->initiated_by === ModTagInitiator::Business) {
                    $notify = 'accepted';

                    return $this->settle($tag, $mod, true, $owner);
                }

                if ($tag->status !== ModTagStatus::Declined) {
                    return $tag;
                }
            }

            if ($tag instanceof ModBusinessTag) {
                $tag->delete();
            }

            $mod->forceFill(['installed_by_business_id' => null])->saveQuietly();
            $tag = new ModBusinessTag;
            $tag->forceFill([
                'mod_id' => $mod->id,
                'business_id' => $business->id,
                'status' => ModTagStatus::Pending,
                'initiated_by' => ModTagInitiator::Member,
                'requested_by' => $owner->id,
            ])->save();

            if ($ownTeam) {
                return $this->settle($tag, $mod, true, $owner);
            }

            $notify = 'requested';

            return $tag;
        });

        if ($notify === 'requested') {
            $this->notifier->businessTag($business->owner, $tag, 'requested', true);
        } elseif ($notify === 'accepted' && ($requester = $tag->requester) instanceof User) {
            $this->notifier->businessTag($requester, $tag, 'accepted', true);
        }

        return $tag;
    }

    /**
     * BIZ-03 "Build markieren": $business proposes $mod (of a public build the member of its team may see); the build's owner confirms.
     */
    public function propose(User $by, Business $business, Modification $mod): ModBusinessTag
    {
        if ($business->status !== BusinessStatus::Verified || $business->removed_at !== null) {
            throw new ApiException(ErrorCode::BusinessNotVerified);
        }

        $vehicle = $mod->vehicle;

        if (! Gate::forUser($by)->allows('view', $mod) || $vehicle->visibility !== Visibility::Public || $vehicle->status !== VehicleStatus::Published) {
            throw ValidationException::withMessages(['mod_id' => [(string) __('parts.tag_not_public')]]);
        }

        $owner = $vehicle->owner;

        if (! $owner instanceof User) {
            throw new ApiException(ErrorCode::NotFound);
        }

        if ($business->roleOf($owner) !== null) {
            return $this->request($owner, $mod, $business);
        }

        $tag = DB::transaction(function () use ($by, $business, $mod): ModBusinessTag {
            Business::query()->whereKey($business->id)->lockForUpdate()->value('id');
            Modification::query()->whereKey($mod->id)->lockForUpdate()->value('id');
            $existing = ModBusinessTag::query()->where('mod_id', $mod->id)->lockForUpdate()->first();

            if ($existing instanceof ModBusinessTag) {
                if ($existing->business_id === $business->id && $existing->status !== ModTagStatus::Declined) {
                    return $existing;
                }

                throw new ApiException(ErrorCode::Conflict, (string) __('parts.tag_exists'));
            }

            $open = ModBusinessTag::query()->where('business_id', $business->id)->where('status', ModTagStatus::Pending->value)
                ->where('initiated_by', ModTagInitiator::Business->value)->count();
            $max = config()->integer('speedclub.businesses.open_proposals_max');

            if ($open >= $max) {
                throw new ApiException(ErrorCode::LimitReached);
            }

            $tag = new ModBusinessTag;
            $tag->forceFill([
                'mod_id' => $mod->id,
                'business_id' => $business->id,
                'status' => ModTagStatus::Pending,
                'initiated_by' => ModTagInitiator::Business,
                'requested_by' => $by->id,
            ])->save();

            return $tag;
        });

        if ($tag->wasRecentlyCreated) {
            $this->notifier->businessTag($owner, $tag, 'requested', false);
        }

        return $tag;
    }

    /**
     * The side that did not ask confirms or declines a pending tag: the business team (BIZ-04) for a member's request, the build's owner
     * for a business's proposal. 409 when it is not pending any more, 403 when $by is not that side.
     */
    public function decide(User $by, ModBusinessTag $tag, bool $accept): ModBusinessTag
    {
        $decided = DB::transaction(function () use ($by, $tag, $accept): ModBusinessTag {
            /** @var ModBusinessTag $locked */
            $locked = ModBusinessTag::query()->whereKey($tag->id)->lockForUpdate()->firstOrFail();
            $mod = Modification::query()->whereKey($locked->mod_id)->lockForUpdate()->firstOrFail();

            if (! $this->decidesFor($by, $locked, $mod)) {
                throw new ApiException(ErrorCode::Forbidden);
            }

            if ($locked->status !== ModTagStatus::Pending) {
                throw new ApiException(ErrorCode::Conflict, (string) __('parts.tag_not_pending'));
            }

            if ($accept && ($locked->business->status !== BusinessStatus::Verified || $locked->business->removed_at !== null)) {
                throw new ApiException(ErrorCode::BusinessNotVerified);
            }

            return $this->settle($locked, $mod, $accept, $by);
        });

        $state = $accept ? 'accepted' : 'declined';

        if ($decided->initiated_by === ModTagInitiator::Member && ($requester = $decided->requester) instanceof User) {
            $this->notifier->businessTag($requester, $decided, $state, false);
        } elseif ($decided->initiated_by === ModTagInitiator::Business) {
            $this->notifier->businessTag($decided->business->owner, $decided, $state, true);
        }

        return $decided;
    }

    /**
     * Either side takes the tag off (the build's owner, or the business team); the portfolio loses the build at once.
     */
    public function remove(User $by, ModBusinessTag $tag): void
    {
        DB::transaction(function () use ($by, $tag): void {
            $locked = ModBusinessTag::query()->whereKey($tag->id)->lockForUpdate()->first();

            if (! $locked instanceof ModBusinessTag) {
                return;
            }

            $mod = Modification::withTrashed()->whereKey($locked->mod_id)->lockForUpdate()->first();
            $isOwner = $mod instanceof Modification && $mod->vehicle->isOwnedBy($by);

            if (! $isOwner && $locked->business->roleOf($by) === null) {
                throw new ApiException(ErrorCode::Forbidden);
            }

            if ($mod instanceof Modification && $mod->installed_by_business_id === $locked->business_id) {
                $mod->forceFill(['installed_by_business_id' => null])->saveQuietly();
            }

            $locked->delete();
        });
    }

    /**
     * Whether $by decides $tag: the side that did not ask.
     */
    public function decidesFor(User $by, ModBusinessTag $tag, Modification $mod): bool
    {
        return $tag->initiated_by === ModTagInitiator::Member
            ? $by->isActive() && $tag->business->roleOf($by) !== null
            : $by->isActive() && $mod->vehicle->isOwnedBy($by);
    }

    private function settle(ModBusinessTag $tag, Modification $mod, bool $accept, User $by): ModBusinessTag
    {
        $tag->forceFill([
            'status' => $accept ? ModTagStatus::Accepted : ModTagStatus::Declined,
            'decided_by' => $by->id,
            'decided_at' => now(),
        ])->save();

        $mod->forceFill(['installed_by_business_id' => $accept ? $tag->business_id : null])->saveQuietly();

        return $tag;
    }
}
