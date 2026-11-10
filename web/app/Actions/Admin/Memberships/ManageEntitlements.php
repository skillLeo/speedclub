<?php

namespace App\Actions\Admin\Memberships;

use App\Enums\MembershipEvent;
use App\Models\Entitlement;
use App\Models\MembershipPlan;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use App\Services\Memberships\Memberships;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ADM-F2 grant and revoke (`memberships.manage`, premium.enabled, with reason; 06 §3: "grant/revoke manually with reason and end date,
 * audited"). A grant needs an active plan and a member who is not closed; it starts now or later and may end; a revoke is final (the row
 * stays as history).
 *
 * @throws AuthorizationException|ValidationException|TeamRefused|NotFoundHttpException
 */
class ManageEntitlements
{
    public function __construct(private readonly Memberships $memberships) {}

    public function grant(Staff $by, User $member, MembershipPlan $plan, string $reason, ?Carbon $startsAt = null, ?Carbon $endsAt = null): Entitlement
    {
        $this->memberships->ensureEnabled();
        StaffAtoms::ensure($by, 'memberships.manage');
        $reason = Reason::required($reason);

        if (! $plan->active) {
            throw new TeamRefused('plan_inactive');
        }

        if ($member->trashed() || $member->isPendingDeletion()) {
            throw new TeamRefused('no_member');
        }

        $startsAt ??= now();

        if ($endsAt !== null && $endsAt->lessThanOrEqualTo($startsAt)) {
            throw new TeamRefused('ends_before_start');
        }

        return DB::transaction(function () use ($by, $member, $plan, $reason, $startsAt, $endsAt): Entitlement {
            $entitlement = new Entitlement;
            $entitlement->forceFill([
                'user_id' => $member->id,
                'plan_id' => $plan->id,
                'granted_by' => $by->getKey(),
                'reason' => $reason,
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
            ])->save();

            Audit::record(MembershipEvent::EntitlementGranted->value, $member, after: [
                'entitlement_id' => $entitlement->id,
                'plan' => $plan->key,
                'starts_at' => $startsAt->toIso8601String(),
                'ends_at' => $endsAt?->toIso8601String(),
            ], reason: $reason, actor: $by);

            return $entitlement;
        });
    }

    public function revoke(Staff $by, Entitlement $entitlement, string $reason): void
    {
        $this->memberships->ensureEnabled();
        StaffAtoms::ensure($by, 'memberships.manage');
        $reason = Reason::required($reason);

        DB::transaction(function () use ($by, $entitlement, $reason): void {
            $locked = Entitlement::query()->whereKey($entitlement->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->revoked_at !== null) {
                throw new TeamRefused('already_revoked');
            }

            $locked->forceFill(['revoked_at' => now(), 'revoked_by' => $by->getKey(), 'revoke_reason' => $reason])->save();
            $entitlement->setRawAttributes($locked->getAttributes(), true);

            Audit::record(MembershipEvent::EntitlementRevoked->value, $locked->member, after: [
                'entitlement_id' => $locked->id,
                'plan' => $locked->plan->key,
            ], reason: $reason, actor: $by);
        });
    }
}
