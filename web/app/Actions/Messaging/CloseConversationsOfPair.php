<?php

namespace App\Actions\Messaging;

use App\Enums\ConversationFolder;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\Messaging\MessagingSignals;
use Illuminate\Support\Facades\DB;

/**
 * A block closes the pair's conversation for both (m2.4-contract §1): hidden from both inboxes, cleared up to its last message, so an
 * unblock does not bring the history back; a new start after an unblock shows only what comes after, and goes through the request
 * step again, as acceptance ends with the block. Called by BlockMember inside its
 * transaction. Sending meanwhile answers 403 cannot_message (recipient_closed), and every route of the conversation 404.
 */
class CloseConversationsOfPair
{
    public function __construct(private readonly MessagingSignals $signals) {}

    public function handle(User $first, User $second): void
    {
        $conversation = Conversation::query()->where('pair_key', Conversation::pairKey($first, $second))->lockForUpdate()->first();

        if (! $conversation instanceof Conversation) {
            return;
        }

        ConversationParticipant::query()->where('conversation_id', $conversation->id)->lockForUpdate()->get();
        ConversationParticipant::query()->where('conversation_id', $conversation->id)->toBase()->update([
            'deleted_at' => now(),
            'cleared_before_message_id' => $conversation->last_message_id,
            // Acceptance ends with the block (lead ruling, review #4): after an unblock a message goes through the request step and
            // who_can_message again. declined_at stays, so a declined request stays declined.
            'accepted_at' => null,
            'folder' => ConversationFolder::Requests->value,
            'unread_count' => 0,
            'pinned_at' => null,
            'archived_at' => null,
            'updated_at' => now(),
        ]);

        DB::afterCommit(fn () => $this->signals->unreadChanged($conversation->id, $first->id, $second->id));
    }
}
