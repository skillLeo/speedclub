<?php

namespace App\Services\Social;

use App\Enums\RestrictionType;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;

/**
 * R5-5 [build_comments]: what a feed card (FeedVehicleResource) and VEH-01 (PublicVehicleResource) tell the app about the car's own
 * comment thread, for a car the reader may already see (the list or the page checked that). No query: the flag is read once per request,
 * the rest are columns. Never a count (01 brief; update threads send none either).
 */
final class VehicleCommentThread
{
    public function __construct(private readonly FeatureFlags $flags) {}

    /**
     * enabled: the thread is open (flag on, the owner's switch on, a published build). can_write: this reader may write now (signed in,
     * active, verified, no publishing restriction), as CommentPolicy::create and the route's not-restricted decide.
     *
     * @return array{enabled: bool, can_write: bool}
     */
    public function state(Vehicle $vehicle, ?User $viewer): array
    {
        $enabled = $this->flags->enabled('build_comments') && $vehicle->getAttribute('comments_enabled') !== false && ! $vehicle->isDraft();

        return [
            'enabled' => $enabled,
            'can_write' => $enabled && $viewer !== null && $viewer->isActive() && $viewer->hasVerifiedEmail() && ! $viewer->isRestrictedFrom(RestrictionType::Publishing),
        ];
    }
}
