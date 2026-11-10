<?php

namespace App\Actions\Messaging;

use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Services\Messaging\Conversations;
use App\Services\Messaging\MessagingSignals;
use Illuminate\Support\Facades\DB;

/**
 * DELETE messages/{id}: "Für mich löschen" (message_hidden). The other side keeps it. An unread message hidden is no longer unread.
 */
class HideMessage
{
    public function __construct(
        private readonly Conversations $conversations,
        private readonly MessagingSignals $signals,
    ) {}

    public function handle(User $member, ConversationParticipant $me, Message $message): void
    {
        DB::transaction(function () use ($member, $me, $message): void {
            $locked = ConversationParticipant::query()->whereKey($me->id)->lockForUpdate()->firstOrFail();

            DB::table('message_hidden')->insertOrIgnore(['message_id' => $message->id, 'user_id' => $member->id, 'created_at' => now()]);

            if ($message->sender_id !== $member->id && ($locked->last_read_message_id === null || strcmp($message->id, $locked->last_read_message_id) > 0)) {
                $unread = $this->conversations->visibleMessages($locked)
                    ->when($locked->last_read_message_id !== null, fn ($query) => $query->where('messages.id', '>', $locked->last_read_message_id))
                    ->where(fn ($query) => $query->where('messages.sender_id', '!=', $member->id)->orWhereNull('messages.sender_id'))
                    ->count();

                ConversationParticipant::query()->whereKey($locked->id)->toBase()->update(['unread_count' => $unread, 'updated_at' => now()]);
            }
        });

        $this->signals->unreadChanged($me->conversation_id, $member->id);
    }
}
