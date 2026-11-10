<?php

namespace App\Policies;

use App\Models\ConversationParticipant;
use App\Models\User;

/**
 * M2.4. Read and written only through the conversation of its member (ConversationPolicy and App\Actions\Messaging); no route reads
 * one on its own.
 */
class ConversationParticipantPolicy
{
    public function view(User $user, ConversationParticipant $model): bool
    {
        return ! $user->isDeactivated() && $model->user_id === $user->id;
    }
}
