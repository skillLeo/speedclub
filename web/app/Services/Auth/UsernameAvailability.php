<?php

namespace App\Services\Auth;

use App\Enums\UsernameUnavailableReason;
use App\Models\User;
use App\Support\Username;

final class UsernameAvailability
{
    /**
     * Null means available. A member's own current name counts as available for them.
     */
    public function reason(string $username, ?User $member = null): ?UsernameUnavailableReason
    {
        $normalized = Username::normalize($username);

        if ($member !== null && $member->username === $normalized) {
            return null;
        }

        $violations = Username::violations($normalized);

        if ($violations !== []) {
            return UsernameUnavailableReason::from($violations[0]);
        }

        return $this->isHeld($normalized) ? UsernameUnavailableReason::Taken : null;
    }

    /**
     * Deleted accounts keep their name until the hard delete, and an old name stays blocked for as long as it redirects.
     */
    private function isHeld(string $username): bool
    {
        $window = now()->subDays(config()->integer('speedclub.usernames.old_username_redirect_days'));

        return User::withTrashed()
            ->where('username', $username)
            ->orWhere(fn ($query) => $query->where('previous_username', $username)->where('username_changed_at', '>', $window))
            ->exists();
    }
}
