<?php

namespace App\Enums;

/**
 * [SIG sig.msg_reactions] The fixed reactions on a message, one per member and message. The six of M2.4 (rendered 👍 ❤️ 🔥 😂 😮 🏁 by the
 * app) and, since Phase 4, the four car words of build reactions (09 §8.5, ADR-413): Stark, Sauber, Tief, Laut. Private to the two
 * members of the conversation, like every message reaction.
 */
enum MessageReaction: string
{
    case ThumbsUp = 'thumbs_up';
    case Heart = 'heart';
    case Fire = 'fire';
    case Laugh = 'laugh';
    case Wow = 'wow';
    case Flag = 'flag';
    case Stark = 'stark';
    case Sauber = 'sauber';
    case Tief = 'tief';
    case Laut = 'laut';
}
