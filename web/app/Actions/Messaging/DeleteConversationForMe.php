<?php

namespace App\Actions\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\Messaging\MessagingSignals;
use Illuminate\Support\Facades\DB;

/**
 * DELETE conversations/{id} (m2.4-contract §1): hidden for the member, everything up to the last message cleared. A later message of
 * the other side brings it back with only what came after. The other side keeps its copy and learns nothing.
 */
class DeleteConversationForMe
{
    public function __construct(
        private readonly MessagingSignals $signals,
        private readonly AnswerRequest $requests,
    ) {}

    public function handle(User $member, ConversationParticipant $me): void
    {
        // A pending request deleted from Anfragen is declined (review #1): the sender stays pending, never told, and cannot write again.
        if ($me->isPendingRequest()) {
            $this->requests->decline($member, $me);

            return;
        }

        DB::transaction(function () use ($me): void {
            $conversation = Conversation::query()->whereKey($me->conversation_id)->lockForUpdate()->firstOrFail();

            ConversationParticipant::query()->whereKey($me->id)->toBase()->update([
                'deleted_at' => now(),
                'cleared_before_message_id' => $conversation->last_message_id,
                'unread_count' => 0,
                'pinned_at' => null,
                'archived_at' => null,
                'updated_at' => now(),
            ]);
        });

        $this->signals->unreadChanged($me->conversation_id, $member->id);
    }
}
