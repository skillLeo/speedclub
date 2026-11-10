<?php

namespace App\Policies;

use App\Models\Decision;
use App\Models\User;
use App\Services\Moderation\DecisionAudience;

/**
 * SAFE-01. The affected member reads a decision that restricted them (not a no_action, which they are never told about); a member who
 * reported the case reads its outcome. Anybody else gets the 404 of an unknown id (the controller), so a decision's existence stays
 * private. Open under every restriction and a suspension: the member must be able to read why and to appeal (Art. 17, 20 DSA).
 */
class DecisionPolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, Decision $decision): bool
    {
        return ! $user->isDeactivated() && app(DecisionAudience::class)->roleOf($user, $decision) !== null;
    }

    /**
     * Who may appeal at all; the deadline and the one-appeal rule are App\Actions\Moderation\FileAppeal's (422, 409).
     */
    public function appeal(User $user, Decision $decision): bool
    {
        return $this->view($user, $decision);
    }
}
