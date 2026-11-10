<?php

namespace App\Enums;

/**
 * Where a conversation sits for one member (conversation_participants.folder). Archived is not a folder of its own: it is a chat with
 * archived_at set (InboxFolder::Archived lists those).
 */
enum ConversationFolder: string
{
    case Chats = 'chats';
    case Requests = 'requests';
}
