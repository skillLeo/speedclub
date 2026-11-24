<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.8 (m5.8-contract §1): a thread waits for pre-moderation (new or unverified accounts), is published, was rejected in
 * pre-moderation (its author still sees it with the reason), removed by a DSA decision (reversible on appeal) or merged into another
 * thread. Deleting by its author is a soft delete.
 */
enum ForumThreadStatus: string
{
    use HasLabel;

    case Pending = 'pending';
    case Published = 'published';
    case Rejected = 'rejected';
    case Removed = 'removed';
    case Merged = 'merged';
}
