<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * SET privacy "Wer darf mich erwähnen" (09 §8.5): everybody, only members who follow me, or nobody. A mention that is not allowed stays
 * plain text: no link, no notification, and the author is not told why.
 */
enum MentionPrivacy: string
{
    use HasLabel;

    case Everyone = 'everyone';
    case Followers = 'followers';
    case Nobody = 'nobody';
}
