<?php

namespace App\Enums;

/**
 * The tabs of MSG-01: `GET conversations?folder=`.
 */
enum InboxFolder: string
{
    case Chats = 'chats';
    case Requests = 'requests';
    case Archived = 'archived';
}
