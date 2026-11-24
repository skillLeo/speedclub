<?php

namespace App\Policies;

use App\Enums\ErrorCode;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Enums\RestrictionType;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Moderation\ModerationHolds;
use App\Services\Showcase\SampleContent;
use App\Support\ViewAs;
use Illuminate\Auth\Access\Response;

/**
 * 02_PRODUCT_SPEC §3.2. Publish preconditions that depend on data (make, model, year, one photo) and the
 * vehicle limit belong to the Actions. Failing restrictions answer 403 account_restricted through
 * EnsureNotRestricted; the policies only say no.
 */
class VehiclePolicy
{
    public function viewAny(?User $user): bool
    {
        return true;
    }

    /**
     * Owner sees everything of theirs. Others: published, not private, owner visible, no block in either direction, and no sample
     * build while editorial_samples is off (09 §8.19: the same 404 as a missing one).
     */
    public function view(?User $user, Vehicle $vehicle): bool
    {
        if ($vehicle->trashed()) {
            return false;
        }

        if ($vehicle->isOwnedBy($user)) {
            return $user !== null && ! $user->isDeactivated();
        }

        $owner = $vehicle->owner;

        if ($owner === null || ! $vehicle->isReachable() || ! $owner->isPubliclyVisible() || app(SampleContent::class)->hides($vehicle, $user)) {
            return false;
        }

        return $user === null || ! $user->hasBlockWith($owner);
    }

    /**
     * Drafts are allowed before the email is verified; publishing is not.
     */
    public function create(User $user): bool
    {
        return $this->canWriteContent($user);
    }

    public function update(User $user, Vehicle $vehicle): bool
    {
        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && $this->canWriteContent($user);
    }

    /**
     * M5.9b part 2: the STREET DEX switches that only hide the car more (Ghost mode, spotting paused, cities hidden) stay available
     * under a publishing restriction, like going private (UpdateVehicle::onlyReducesExposure decides what a body may hold).
     */
    public function reduceExposure(User $user, Vehicle $vehicle): bool
    {
        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
    }

    /**
     * Stays available under a restriction: a member can always take their own content down.
     */
    public function delete(User $user, Vehicle $vehicle): bool
    {
        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
    }

    /**
     * The owner of a draft who only lacks the verification hears about that: 403 email_not_verified, which sends the
     * client to AUTH-05. An owner who may publish may also ask again for a vehicle that is published by now: PublishVehicle
     * answers that with the vehicle and changes nothing, so a wizard whose first answer got lost reaches the end (ADR-176a).
     */
    public function publish(User $user, Vehicle $vehicle): Response|bool
    {
        if (! $this->update($user, $vehicle)) {
            return false;
        }

        return $user->hasVerifiedEmail() ? true : Response::deny(code: ErrorCode::EmailNotVerified->value);
    }

    /**
     * A publishing restriction blocks exposure, not hiding: going private stays possible. A build that moderation removed
     * (remove_content, M2.6) stays private until an appeal reverses it (ModerationHolds).
     */
    public function changeVisibility(User $user, Vehicle $vehicle, Visibility $to): bool
    {
        if ($to === Visibility::Private) {
            return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
        }

        return $this->update($user, $vehicle) && ! app(ModerationHolds::class)->holds($vehicle);
    }

    public function setMain(User $user, Vehicle $vehicle): bool
    {
        return $this->update($user, $vehicle) && $vehicle->status === VehicleStatus::Published;
    }

    /**
     * M5.7 INS-01 (10 §6.1, m5.7-contract §10): the car's statistics are the owner's alone; staff in view-as get 403 view_as_read_only
     * (owner-only like the private budget, ADR-441). Open under a restriction.
     */
    public function viewInsights(User $user, Vehicle $vehicle): Response|bool
    {
        if (ViewAs::active()) {
            return Response::deny(code: ErrorCode::ViewAsReadOnly->value);
        }

        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
    }

    /**
     * Reading and downloading the owner's own code. No restriction stops it; a suspended member's code simply leads nowhere.
     */
    public function manageQr(User $user, Vehicle $vehicle): bool
    {
        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
    }

    /**
     * M5.4: changing the sticker design (autosave, restore, Scan-Test, order link). Reading and downloading is manageQr. Open under a
     * publishing restriction like the code itself (a sticker is no publication on the platform); a suspended owner only reads.
     */
    public function designSticker(User $user, Vehicle $vehicle): bool
    {
        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && $user->isActive();
    }

    /**
     * Revoking must stay possible when the car is sold, so only a suspension or a deleted account stops it. A code staff took down
     * (ADM-18/19) stays down until staff issue a new one: a reissue by the owner would undo the takedown with a fresh active code.
     */
    public function reissueQr(User $user, Vehicle $vehicle): Response|bool
    {
        if (! $vehicle->isOwnedBy($user) || $vehicle->trashed() || ! $user->isActive() || $vehicle->status !== VehicleStatus::Published) {
            return false;
        }

        $hasActive = $vehicle->qrCodes()->where('status', QrStatus::Active)->exists();
        $latest = $hasActive ? null : $vehicle->qrCodes()->latest()->latest('id')->first();

        return $latest?->getAttribute('revoked_reason') === QrRevocationReason::Moderation
            ? Response::deny(code: ErrorCode::QrRevokedByStaff->value)
            : true;
    }

    /**
     * M4.13 (09 §8.8): maintenance, the service log, its photos and the cost totals are the owner's alone. Private data, not publishing:
     * no restriction stops it (a suspended member still keeps their service history); a closed account does.
     */
    public function maintain(User $user, Vehicle $vehicle): bool
    {
        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
    }

    /**
     * M5.9b DEX-06 (m5.9b contract §4): the spot numbers of a car are its owner's alone. Private data, not publishing: no restriction
     * stops reading them.
     */
    public function viewSpotStats(User $user, Vehicle $vehicle): bool
    {
        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
    }

    /**
     * M5.9b DEX-04: the card of a car the member may see. Whether it shows their spot or the "noch nicht gespottet" preview is the
     * controller's question (a preview needs a public car that is not in ghost mode, unless it is the member's own).
     */
    public function viewDexCard(User $user, Vehicle $vehicle): bool
    {
        return ! $user->isDeactivated() && $this->view($user, $vehicle);
    }

    private function canWriteContent(User $user): bool
    {
        return ! $user->isDeactivated() && ! $user->isRestrictedFrom(RestrictionType::Publishing);
    }
}
