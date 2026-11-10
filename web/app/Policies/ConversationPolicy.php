<?php

namespace App\Policies;

use App\Models\Conversation;
use App\Models\User;

/**
 * M2.4. A member reaches only conversations they are an active participant of; any other is the same 404 as an id that never existed,
 * through App\Services\Messaging\Conversations::participantFor, never a 403. Who may write is MessagingEligibility (403 cannot_message).
 * A deactivated account has no conversations to read.
 */
class ConversationPolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, Conversation $conversation): bool
    {
        return ! $user->isDeactivated() && $conversation->participants()->where('user_id', $user->id)->whereNull('deleted_at')->exists();
    }
}
