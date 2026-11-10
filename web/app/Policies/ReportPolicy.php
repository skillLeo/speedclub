<?php

namespace App\Policies;

use App\Models\Report;
use App\Models\User;

/**
 * Reporting is a safety tool (m2.6-contract §2): open to unverified, restricted and suspended members, never to a deactivated account.
 * Whether the target may be seen and is not the reporter's own is App\Services\Moderation\ReportTargets.
 */
class ReportPolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, Report $report): bool
    {
        return ! $user->isDeactivated() && $report->reporter_id === $user->id;
    }

    public function create(User $user): bool
    {
        return ! $user->isDeactivated();
    }
}
