<?php

namespace App\Policies;

use App\Enums\CrewRole;
use App\Enums\ErrorCode;
use App\Models\Crew;
use App\Models\User;
use App\Services\Showcase\SampleContent;
use Illuminate\Auth\Access\Response;

/**
 * R4-2.3 crews (contract-crews.md §3, §4). Anybody (guests too) sees an active crew; its own members also see it while staff keep it
 * hidden; nobody sees a deleted one. A sample crew is nobody's while editorial_samples is off. Founder and admins run the crew; only the
 * founder changes roles, hands over and deletes. Blocks hide members, not crews (C3).
 */
class CrewPolicy
{
    public function view(?User $viewer, Crew $crew): bool
    {
        if ($crew->trashed()) {
            return false;
        }

        if ($viewer !== null && ! $viewer->isDeactivated() && $crew->roleOf($viewer) !== null) {
            return true;
        }

        return $crew->isActive() && ! ($crew->is_sample && ! app(SampleContent::class)->visible());
    }

    public function create(User $user): Response|bool
    {
        if (! $user->isActive()) {
            return false;
        }

        return $user->hasVerifiedEmail() ? true : Response::deny(code: ErrorCode::EmailNotVerified->value);
    }

    /**
     * Join, ask to join, accept an invitation: an active account with a verified address.
     */
    public function join(User $user, Crew $crew): Response|bool
    {
        return $this->create($user);
    }

    /**
     * Edit, logo and cover, invitations, requests, removing plain members: founder and admins.
     */
    public function update(User $user, Crew $crew): bool
    {
        return ! $user->isDeactivated() && ($crew->roleOf($user)?->runsCrew() ?? false);
    }

    /**
     * Roles, hand-over, removing admins, deleting the crew: the founder.
     */
    public function manage(User $user, Crew $crew): bool
    {
        return ! $user->isDeactivated() && $crew->roleOf($user) === CrewRole::Founder;
    }
}
