<?php

namespace App\Policies;

use App\Models\Conversation;
use App\Models\MessageReactionRow;
use App\Models\User;

/**
 * M2.4. Read and written only through the conversation of its member (ConversationPolicy and App\Actions\Messaging); no route reads
 * one on its own.
 */
class MessageReactionRowPolicy
{
    public function view(User $user, MessageReactionRow $model): bool
    {
        $conversation = $model->message?->conversation;

        return ! $user->isDeactivated() && $conversation instanceof Conversation && (new ConversationPolicy)->view($user, $conversation);
    }
}
