<?php

namespace App\Policies;

use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;

/**
 * M2.4. Read and written only through the conversation of its member (ConversationPolicy and App\Actions\Messaging); no route reads
 * one on its own.
 */
class MessagePolicy
{
    public function view(User $user, Message $model): bool
    {
        $conversation = $model->conversation;

        return ! $user->isDeactivated() && $conversation instanceof Conversation && (new ConversationPolicy)->view($user, $conversation);
    }
}
