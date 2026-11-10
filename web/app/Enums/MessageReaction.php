<?php

namespace App\Enums;

/**
 * [SIG sig.msg_reactions] The six fixed reactions, rendered 👍 ❤️ 🔥 😂 😮 🏁 by the app. One per member and message.
 */
enum MessageReaction: string
{
    case ThumbsUp = 'thumbs_up';
    case Heart = 'heart';
    case Fire = 'fire';
    case Laugh = 'laugh';
    case Wow = 'wow';
    case Flag = 'flag';
}
