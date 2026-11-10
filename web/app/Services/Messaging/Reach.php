<?php

namespace App\Services\Messaging;

use App\Enums\CannotMessageReason;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\Social\MessagingEligibility;

/**
 * Whether what a member does in a conversation may reach the other side now (a photo upload, a reaction, a typing signal), by the rule
 * of a send (MessagingEligibility, with the other side's acceptance).
 */
class Reach
{
    public function __construct(
        private readonly Conversations $conversations,
        private readonly MessagingEligibility $eligibility,
    ) {}

    /**
     * @return array{0: CannotMessageReason|null, 1: ConversationParticipant|null, 2: User|null, 3: bool} the reason (null: may reach),
     *                                                                                                    the other side, its account,
     *                                                                                                    whether it follows the member
     */
    public function check(User $member, ConversationParticipant $me): array
    {
        $other = $this->conversations->otherOf($me);
        $recipient = $other === null ? null : User::withTrashed()->find($other->user_id);

        if ($other === null || ! $recipient instanceof User) {
            return [CannotMessageReason::RecipientClosed, $other, null, false];
        }

        $follows = $this->eligibility->follows($recipient, $member);

        return [$this->eligibility->reason($member, $recipient, $follows, accepted: $other->accepted_at !== null, blocked: false), $other, $recipient, $follows];
    }
}
