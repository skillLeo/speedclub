<?php

namespace App\Services\Social;

use App\Enums\CannotMessageReason;
use App\Enums\RestrictionType;
use App\Enums\WhoCanMessage;
use App\Models\Follow;
use App\Models\User;
use App\Services\Showcase\SampleContent;

/**
 * Whether a viewer may write to a member now (02_PRODUCT_SPEC §3.5, §3.6). The one place for the rule: PROF-02's `can_message` reads it,
 * and M2.4's POST conversations and POST conversations/{id}/messages enforce the same.
 *
 * The viewer: signed in, active, verified (§3.1), not restricted from messaging, not the member. The member: publicly visible, no
 * block either way, and `who_can_message` is everyone, or following and the member follows the viewer.
 *
 * "Wer darf dir schreiben" decides who may start a conversation and send the one message of a request. Once the member has accepted
 * the conversation (accepted a request, written in it, or started it), it stays open whatever the setting says later; a block, a
 * restriction, a missing verification or an account that is gone still close it (m2.4 handover, proposed ADR).
 */
class MessagingEligibility
{
    /**
     * @param  bool|null  $memberFollowsViewer  when the caller already knows it (PROF-02 reads both follow directions in one query)
     */
    public function canMessage(?User $viewer, User $member, ?bool $memberFollowsViewer = null): bool
    {
        return $viewer !== null && $this->reason($viewer, $member, $memberFollowsViewer) === null;
    }

    /**
     * Null when the viewer may write; otherwise why not. A block is recipient_closed, like a closed setting, so it is never revealed.
     *
     * @param  bool  $accepted  the member has accepted the conversation already: the setting no longer applies
     * @param  bool|null  $blocked  when the caller already knows whether a block exists either way
     */
    public function reason(User $viewer, User $member, ?bool $memberFollowsViewer = null, bool $accepted = false, ?bool $blocked = null): ?CannotMessageReason
    {
        if ($viewer->is($member) || ! $viewer->isActive()) {
            return CannotMessageReason::RecipientClosed;
        }

        if (! $viewer->hasVerifiedEmail()) {
            return CannotMessageReason::NotVerified;
        }

        if ($viewer->isRestrictedFrom(RestrictionType::Messaging)) {
            return CannotMessageReason::Restricted;
        }

        // 09 §8.19: a sample member is closed to messages while editorial_samples is off.
        if ($member->trashed() || ! $member->isPubliclyVisible() || ($blocked ?? $viewer->hasBlockWith($member)) || app(SampleContent::class)->hides($member, $viewer)) {
            return CannotMessageReason::RecipientClosed;
        }

        if ($accepted) {
            return null;
        }

        $setting = $member->getAttribute('who_can_message');

        $open = match ($setting instanceof WhoCanMessage ? $setting : WhoCanMessage::Everyone) {
            WhoCanMessage::Everyone => true,
            WhoCanMessage::Following => $memberFollowsViewer ?? $this->follows($member, $viewer),
            WhoCanMessage::Nobody => false,
        };

        return $open ? null : CannotMessageReason::RecipientClosed;
    }

    public function follows(User $follower, User $followee): bool
    {
        return Follow::query()->where('follower_id', $follower->id)->where('followee_id', $followee->id)->exists();
    }
}
