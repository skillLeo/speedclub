<?php

namespace App\Services\Messaging;

use App\Models\User;

/**
 * Who may join a private channel (m2.4-contract §2, POST broadcasting/auth): private-user.{own id}, and private-conversation.{id} of a
 * conversation the member is an active participant of, with no block either way. Every other name is refused.
 */
class ChannelAccess
{
    public function __construct(private readonly Conversations $conversations) {}

    public function allows(User $member, string $channel): bool
    {
        if ($member->isDeactivated()) {
            return false;
        }

        if (preg_match('/\Aprivate-user\.([0-9a-hjkmnp-tv-z]{26})\z/i', $channel, $match) === 1) {
            return strtolower($match[1]) === strtolower($member->id);
        }

        if (preg_match('/\Aprivate-conversation\.([0-9a-hjkmnp-tv-z]{26})\z/i', $channel, $match) === 1) {
            return $this->conversations->participantFor($member, $match[1]) !== null;
        }

        return false;
    }
}
