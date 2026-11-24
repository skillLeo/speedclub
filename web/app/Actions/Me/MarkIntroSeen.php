<?php

namespace App\Actions\Me;

use App\Models\User;

/**
 * R4-1.4 (INTRO-01…04): the member finished or skipped the introduction. Idempotent: the first time stays, so a second device that
 * sends it again changes nothing.
 */
final class MarkIntroSeen
{
    public function handle(User $member): void
    {
        $query = User::query()->whereKey($member->getKey());
        (clone $query)->whereNull('intro_seen_at')->update(['intro_seen_at' => now()]);

        // The caller's model answers the stored time from here on, whichever request set it.
        $member->forceFill(['intro_seen_at' => $query->value('intro_seen_at')])->syncOriginalAttribute('intro_seen_at');
    }
}
